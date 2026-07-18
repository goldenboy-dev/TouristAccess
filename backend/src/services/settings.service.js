/**
 * Operational config: horario de operación + aforo máximo diario. Reuses the
 * AppSetting key-value table pricing already uses (see ticket.service.js) —
 * that table was deliberately generic so this didn't need its own migration.
 *
 * Unconfigured = unrestricted: an existing deployment that never touches this
 * panel keeps working exactly as before (no hours enforced, no cap enforced).
 */
const prisma = require('../utils/prisma');
const { badRequest } = require('../utils/errors');
const { startOfLocalDay, endOfLocalDay } = require('../utils/date');
const { COUNTED_STATUSES } = require('../constants/ticket');
const { TIME_RE } = require('../constants/settings');

const HOURS_START_KEY = 'operating_hours_start';
const HOURS_END_KEY = 'operating_hours_end';
const MAX_CAPACITY_KEY = 'max_daily_capacity';

async function getOperatingSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [HOURS_START_KEY, HOURS_END_KEY, MAX_CAPACITY_KEY] } },
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    operating_hours_start: byKey[HOURS_START_KEY] || null,
    operating_hours_end: byKey[HOURS_END_KEY] || null,
    max_daily_capacity: byKey[MAX_CAPACITY_KEY] ? parseInt(byKey[MAX_CAPACITY_KEY], 10) : null,
  };
}

function upsertSetting(key, value, actorId) {
  return prisma.appSetting.upsert({
    where: { key },
    create: { key, value, updatedById: actorId },
    update: { value, updatedById: actorId },
  });
}

// Zod (updateOperatingSettingsSchema) already rejects malformed bodies at the
// edge; these are the last line of defence for any caller reaching the
// service directly — same split as assertCreateInvariants in ticket.service.js.
async function updateOperatingSettings(input, actorId) {
  const { operating_hours_start, operating_hours_end, max_daily_capacity } = input;
  const ops = [];

  const hoursProvided = operating_hours_start !== undefined || operating_hours_end !== undefined;
  if (hoursProvided) {
    if (operating_hours_start === undefined || operating_hours_end === undefined) {
      throw badRequest('operating_hours_start y operating_hours_end deben enviarse juntos');
    }
    const bothNull = operating_hours_start === null && operating_hours_end === null;
    const bothSet = operating_hours_start !== null && operating_hours_end !== null;
    if (!bothNull && !bothSet) {
      throw badRequest('operating_hours_start y operating_hours_end deben enviarse juntos (ambos con hora o ambos vacíos)');
    }
    if (bothSet) {
      if (!TIME_RE.test(operating_hours_start) || !TIME_RE.test(operating_hours_end)) {
        throw badRequest('Formato de hora inválido (HH:MM)');
      }
      if (operating_hours_start >= operating_hours_end) {
        throw badRequest('operating_hours_start debe ser anterior a operating_hours_end');
      }
      ops.push(upsertSetting(HOURS_START_KEY, operating_hours_start, actorId));
      ops.push(upsertSetting(HOURS_END_KEY, operating_hours_end, actorId));
    } else {
      ops.push(prisma.appSetting.deleteMany({ where: { key: { in: [HOURS_START_KEY, HOURS_END_KEY] } } }));
    }
  }

  if (max_daily_capacity !== undefined) {
    if (max_daily_capacity === null) {
      ops.push(prisma.appSetting.deleteMany({ where: { key: MAX_CAPACITY_KEY } }));
    } else {
      const capacity = parseInt(max_daily_capacity, 10);
      if (!Number.isInteger(capacity) || capacity <= 0) {
        throw badRequest('max_daily_capacity debe ser un entero positivo');
      }
      ops.push(upsertSetting(MAX_CAPACITY_KEY, String(capacity), actorId));
    }
  }

  if (ops.length === 0) throw badRequest('Nada para actualizar');
  await prisma.$transaction(ops);
}

// No settings row ⇒ unrestricted, so a fresh/unconfigured deployment never
// blocks a scan that used to go through.
function isWithinOperatingHours(settings, date = new Date()) {
  if (!settings.operating_hours_start || !settings.operating_hours_end) return true;

  const nowMinutes = date.getHours() * 60 + date.getMinutes();
  const [startH, startM] = settings.operating_hours_start.split(':').map(Number);
  const [endH, endM] = settings.operating_hours_end.split(':').map(Number);
  return nowMinutes >= startH * 60 + startM && nowMinutes <= endH * 60 + endM;
}

// Counts real sales only (ACTIVE + USED) — a cancelled ticket frees up its
// spot in the cap, same as it already does for revenue and fraud metrics.
async function getSoldCountForDate(visitDate) {
  return prisma.ticket.count({
    where: {
      visit_date: { gte: startOfLocalDay(visitDate), lte: endOfLocalDay(visitDate) },
      status: { in: COUNTED_STATUSES },
    },
  });
}

module.exports = {
  getOperatingSettings,
  updateOperatingSettings,
  isWithinOperatingHours,
  getSoldCountForDate,
};
