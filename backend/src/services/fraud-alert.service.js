/**
 * Persistence for fraud alerts.
 *
 * fraud.service.js `deriveAlerts` recomputes the alert list fresh from ticket
 * data on every call (the fraud panel polls it every 60s) — nothing survives
 * between calls. This layer turns that ephemeral list into a queryable
 * history an admin can triage (revisada/desestimada/escalada) without a
 * status change getting overwritten by the next auto-refresh.
 */
const prisma = require('../utils/prisma');
const { notFound, badRequest } = require('../utils/errors');
const { resolveLocalDay, startOfLocalDay, endOfLocalDay } = require('../utils/date');
const { ALERT_STATUSES } = require('../constants/fraud');

// `a.id` is the synthetic key deriveAlerts() already builds
// (`alert-${cajero_id}-${suffix}`) — stable per date+cajero+tipo, so repeated
// calls for the same day upsert the same row instead of duplicating it.
// Status/reviewedBy/reviewedAt are deliberately absent from `update`: a
// human decision must survive the numbers refreshing under it.
async function persistAlerts(dateStr, alerts) {
  const { dayStart } = resolveLocalDay(dateStr);

  return Promise.all(alerts.map((a) => prisma.fraudAlert.upsert({
    where: { alert_key: a.id },
    create: {
      alert_key: a.id,
      date: dayStart,
      cajero_id: a.cajero_id,
      nivel: a.nivel,
      tipo: a.tipo,
      mensaje: a.mensaje,
      detalle: a.detalle,
    },
    update: {
      nivel: a.nivel,
      mensaje: a.mensaje,
      detalle: a.detalle,
    },
  })));
}

function toApiShape(row) {
  return {
    id: row.id,
    alert_key: row.alert_key,
    date: row.date,
    cajero_id: row.cajero_id,
    cajero_nombre: row.cajero ? (row.cajero.name || row.cajero.email.split('@')[0]) : null,
    nivel: row.nivel,
    tipo: row.tipo,
    mensaje: row.mensaje,
    detalle: row.detalle,
    status: row.status,
    reviewed_by: row.reviewedBy ? (row.reviewedBy.name || row.reviewedBy.email.split('@')[0]) : null,
    reviewed_at: row.reviewed_at,
    review_note: row.review_note,
  };
}

async function listAlertHistory({ status, nivel, cajero_id, date_from, date_to, page, limit }) {
  const where = {};
  if (status) where.status = status;
  if (nivel) where.nivel = nivel;
  if (cajero_id) where.cajero_id = cajero_id;
  if (date_from || date_to) {
    where.date = {};
    if (date_from) where.date.gte = startOfLocalDay(date_from);
    if (date_to)   where.date.lte = endOfLocalDay(date_to);
  }

  const [rows, total] = await Promise.all([
    prisma.fraudAlert.findMany({
      where,
      include: {
        cajero: { select: { name: true, email: true } },
        reviewedBy: { select: { name: true, email: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.fraudAlert.count({ where }),
  ]);

  return { entries: rows.map(toApiShape), total, page, limit };
}

async function updateAlertStatus({ id, status, note, reviewedById }) {
  if (!ALERT_STATUSES.includes(status)) {
    throw badRequest(`status debe ser uno de: ${ALERT_STATUSES.join(', ')}`);
  }

  const existing = await prisma.fraudAlert.findUnique({ where: { id } });
  if (!existing) throw notFound('Alerta no encontrada');

  const updated = await prisma.fraudAlert.update({
    where: { id },
    data: {
      status,
      review_note: note ?? existing.review_note,
      reviewed_by_id: reviewedById,
      reviewed_at: new Date(),
    },
    include: {
      cajero: { select: { name: true, email: true } },
      reviewedBy: { select: { name: true, email: true } },
    },
  });

  return { previous: existing, updated: toApiShape(updated) };
}

module.exports = { persistAlerts, listAlertHistory, updateAlertStatus };
