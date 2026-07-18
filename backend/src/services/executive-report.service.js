/**
 * Dashboard ejecutivo: ingresos y tickets agregados por día/semana/mes.
 *
 * "Semana"/"mes" son ventanas rodantes (últimos 7 / últimos 30 días,
 * incluyendo hoy), no semana/mes calendario — evita el caso raro de un mes
 * que arranca el día 1 con una sola jornada de datos y mantiene todo
 * derivable de una sola consulta.
 *
 * Mismo motivo que fraud.service.js para usar SQL crudo en vez de
 * `groupBy`: hay que agrupar por una expresión de fecha (`date_trunc`), no
 * por una columna real.
 */
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const { startOfToday, toLocalDateStr, parseLocalDate } = require('../utils/date');
const { COUNTED_STATUSES } = require('../constants/ticket');

// Cubre la ventana más grande que reportamos ("mes" = últimos 30 días); el
// gráfico solo muestra la cola de esta misma serie, sin una segunda consulta.
const FETCH_WINDOW_DAYS = 30;

function queryDailyRevenue(startDate, endDate) {
  return prisma.$queryRaw`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
           COUNT(*)::int AS tickets,
           COALESCE(SUM("price"), 0)::int AS revenue
    FROM "Ticket"
    WHERE "createdAt" >= ${startDate}
      AND "createdAt" < ${endDate}
      AND "status" IN (${Prisma.join(COUNTED_STATUSES)})
    GROUP BY 1
    ORDER BY 1
  `;
}

// ─── Pure helpers (unit-testable, no DB) ─────────────────────

/** 'YYYY-MM-DD' shifted by `n` calendar days (n can be negative). */
function shiftDateStr(dateStr, n) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
}

/** Zero-filled day-by-day series ending on `todayStr`, `days` long. */
function buildDailySeries(rows, todayStr, days) {
  const byDate = new Map(rows.map(r => [r.date, r]));
  const series = [];
  let cursor = shiftDateStr(todayStr, -(days - 1));
  while (cursor <= todayStr) {
    const row = byDate.get(cursor);
    series.push({ date: cursor, revenue: row?.revenue || 0, tickets: row?.tickets || 0 });
    cursor = shiftDateStr(cursor, 1);
  }
  return series;
}

/** Rolling day/week/month totals (today, last 7 days, last 30 days), all ending on `todayStr`. */
function summarizeDailySeries(rows, todayStr) {
  const sumSince = (fromStr) => rows.reduce((acc, r) => {
    if (r.date >= fromStr && r.date <= todayStr) {
      acc.revenue += r.revenue;
      acc.tickets += r.tickets;
    }
    return acc;
  }, { revenue: 0, tickets: 0 });

  return {
    today: sumSince(todayStr),
    week: sumSince(shiftDateStr(todayStr, -6)),
    month: sumSince(shiftDateStr(todayStr, -(FETCH_WINDOW_DAYS - 1))),
  };
}

// ─── Entry point ──────────────────────────────────────────────
async function getExecutiveSummary({ days } = {}) {
  const chartDays = days || 14;
  const today = startOfToday();
  const todayStr = toLocalDateStr(today);

  const startDate = parseLocalDate(shiftDateStr(todayStr, -(FETCH_WINDOW_DAYS - 1)));
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 1); // exclusivo: mañana a las 00:00 local

  const rawRows = await queryDailyRevenue(startDate, endDate);
  // bigint/Decimal → number ya vienen resueltos por los casts SQL (::int), pero
  // Prisma igual devuelve el `date` como string — normalizamos por las dudas.
  const rows = rawRows.map(r => ({ date: String(r.date), revenue: r.revenue, tickets: r.tickets }));

  const { today: todayTotals, week, month } = summarizeDailySeries(rows, todayStr);
  const fullSeries = buildDailySeries(rows, todayStr, FETCH_WINDOW_DAYS);

  return {
    today: todayTotals,
    week,
    month,
    dailySeries: fullSeries.slice(-chartDays),
  };
}

module.exports = {
  getExecutiveSummary,
  // Exportados para unit tests — puros, sin DB.
  shiftDateStr,
  buildDailySeries,
  summarizeDailySeries,
};
