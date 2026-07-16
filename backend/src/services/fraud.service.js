const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const { logger } = require('../utils/logger');
const { resolveLocalDay, toLocalDateStr, startOfToday } = require('../utils/date');
const { FREE_VISITOR_TYPES, COUNTED_STATUSES } = require('../constants/ticket');

// ─── Config from env ─────────────────────────────────────────
const ADULT_PRICE       = parseInt(process.env.ADULT_PRICE) || 10000;
const PP_CRITICAL       = parseInt(process.env.ALERT_FREE_PP_CRITICAL) || 20;
const PP_WARNING        = parseInt(process.env.ALERT_FREE_PP_WARNING) || 10;
const HISTORY_DAYS      = parseInt(process.env.HISTORY_DAYS) || 30;
const FREE_PCT_LIMIT    = parseInt(process.env.ALERT_FREE_PCT_LIMIT) || 25;

// Reference used when there is no history at all to compare against.
const DEFAULT_HIST_PCT = 15;

// ─── Helpers ─────────────────────────────────────────────────
function r2(n) { return Math.round(n * 100) / 100; }

// Dates are resolved in local time (see utils/date.js): a UTC-parsed
// YYYY-MM-DD lands on the previous day here, which would silently report the
// wrong day's fraud metrics.
const resolveDay = resolveLocalDay;

// ─── Queries ─────────────────────────────────────────────────
// Per-cashier average of the DAILY free-entry percentage over the history
// window. Aggregated in Postgres in two levels (day, then cashier) so the
// result is one row per cashier no matter how many tickets exist — this used
// to pull every historical ticket into memory and average them in JS.
function queryHistoricalPctByCashier(histStart, histEnd) {
  return prisma.$queryRaw`
    SELECT cashier_id,
           AVG(pct)  AS avg_pct,
           COUNT(*)::int AS days
    FROM (
      SELECT "createdById" AS cashier_id,
             date_trunc('day', "createdAt") AS day,
             (COUNT(*) FILTER (WHERE "visitor_type" IN (${Prisma.join(FREE_VISITOR_TYPES)}))::float
               / NULLIF(COUNT(*), 0)::float) * 100 AS pct
      FROM "Ticket"
      WHERE "createdAt" >= ${histStart}
        AND "createdAt" <= ${histEnd}
        AND "status" IN (${Prisma.join(COUNTED_STATUSES)})
      GROUP BY 1, 2
    ) daily
    GROUP BY cashier_id
  `;
}

// Operation counts per cashier for the day. The "suspicious" condition is a
// row-level expression (more free entries than paying adults), so it is a
// FILTER inside the aggregate rather than a JS filter over fetched rows.
function queryOperationsByCashier(dayStart, dayEnd) {
  return prisma.$queryRaw`
    SELECT "cajero_id" AS cashier_id,
           COUNT(*)::int AS total_operaciones,
           COUNT(*) FILTER (
             WHERE "total_children" + "total_locals" >= "total_adults"
           )::int AS operaciones_sospechosas
    FROM "GroupSummary"
    WHERE "createdAt" >= ${dayStart}
      AND "createdAt" <= ${dayEnd}
    GROUP BY "cajero_id"
  `;
}

// ─── Pure metric builders (unit-testable, no DB) ─────────────

// The reference for a cashier with no history of their own: the mean of every
// daily percentage across all cashiers. Reconstructed from the per-cashier
// averages by weighting each by its number of days, which is the same number
// the old flat-list average produced — without a second query.
function computeGlobalHistAvg(histRows) {
  let weighted = 0, days = 0;
  for (const row of histRows) {
    weighted += Number(row.avg_pct) * row.days;
    days += row.days;
  }
  return days > 0 ? weighted / days : DEFAULT_HIST_PCT;
}

function classifyRisk({ brecha_ingresos, diferencia_pp }) {
  if (brecha_ingresos > 0 || diferencia_pp >= PP_CRITICAL) return 'CRITICO';
  if (diferencia_pp >= PP_WARNING) return 'AVISO';
  return 'NORMAL';
}

function buildCashierMetrics({ cashier, todayStats, ops, historico_pct_gratuitos }) {
  const { total_adults, total_children, total_locals, total_persons, ingresos_declarados } = todayStats;
  const total_gratuitos = total_children + total_locals;

  const pct_gratuitos_hoy = total_persons > 0 ? r2((total_gratuitos / total_persons) * 100) : 0;
  const ingresos_esperados = total_adults * ADULT_PRICE;

  let brecha_ingresos = ingresos_esperados - ingresos_declarados;
  if (brecha_ingresos < 0) {
    // Declared more than expected: not fraud, but it means pricing drifted
    // from what the tickets were charged at. Worth knowing, not worth alerting.
    logger.warn({ event: 'fraud.negative_gap', cashierId: cashier.id, gap: brecha_ingresos });
    brecha_ingresos = 0;
  }

  const diferencia_pp = r2(pct_gratuitos_hoy - historico_pct_gratuitos);

  return {
    cajero_id: cashier.id,
    cajero_nombre: cashier.name || cashier.email.split('@')[0],
    cajero_email: cashier.email,
    total_adults,
    total_children,
    total_locals,
    total_gratuitos,
    total_persons,
    pct_gratuitos_hoy,
    historico_pct_gratuitos,
    diferencia_pp,
    ingresos_esperados,
    ingresos_declarados,
    brecha_ingresos,
    nivel_riesgo: classifyRisk({ brecha_ingresos, diferencia_pp }),
    total_operaciones: ops.total_operaciones,
    operaciones_sospechosas: ops.operaciones_sospechosas,
  };
}

// Folds the (cashier, visitor_type) groupBy rows into per-cashier totals.
function indexTodayStats(groupedRows) {
  const byCashier = new Map();

  for (const row of groupedRows) {
    if (!byCashier.has(row.createdById)) {
      byCashier.set(row.createdById, {
        total_adults: 0, total_children: 0, total_locals: 0,
        total_persons: 0, ingresos_declarados: 0,
      });
    }
    const stats = byCashier.get(row.createdById);
    const count = row._count._all;

    if (row.visitor_type === 'ADULT') stats.total_adults += count;
    else if (row.visitor_type === 'CHILD') stats.total_children += count;
    else if (row.visitor_type === 'LOCAL') stats.total_locals += count;

    stats.total_persons += count;
    stats.ingresos_declarados += row._sum.price || 0;
  }

  return byCashier;
}

// ─── Core: fraud metrics for all cashiers on a date ──────────
async function calculateCashierFraudMetrics(dateStr) {
  const { dayStart, dayEnd } = resolveDay(dateStr);

  const histStart = new Date(dayStart);
  histStart.setDate(histStart.getDate() - HISTORY_DAYS);
  const histEnd = new Date(dayStart);
  histEnd.setMilliseconds(-1); // up to the day before the one being analysed

  // All four are independent — one round trip.
  const [todayRows, cashiers, opsRows, histRows] = await Promise.all([
    prisma.ticket.groupBy({
      by: ['createdById', 'visitor_type'],
      where: {
        createdAt: { gte: dayStart, lte: dayEnd },
        status: { in: COUNTED_STATUSES },
      },
      _count: { _all: true },
      _sum: { price: true },
    }),
    prisma.user.findMany({
      where: { role: 'CASHIER' },
      select: { id: true, email: true, name: true },
    }),
    queryOperationsByCashier(dayStart, dayEnd),
    queryHistoricalPctByCashier(histStart, histEnd),
  ]);

  const todayByCashier = indexTodayStats(todayRows);
  const opsByCashier = new Map(opsRows.map(r => [r.cashier_id, r]));
  const histByCashier = new Map(histRows.map(r => [r.cashier_id, Number(r.avg_pct)]));
  const globalHistAvg = computeGlobalHistAvg(histRows);

  const cajeros = [];
  let totalVisitantes = 0, totalDeclarado = 0, totalEsperado = 0;
  let alertasCriticas = 0, alertasAviso = 0;

  for (const cashier of cashiers) {
    const todayStats = todayByCashier.get(cashier.id);
    if (!todayStats) continue; // no activity today

    const historico = histByCashier.has(cashier.id)
      ? r2(histByCashier.get(cashier.id))
      : r2(globalHistAvg);

    const metrics = buildCashierMetrics({
      cashier,
      todayStats,
      ops: opsByCashier.get(cashier.id) || { total_operaciones: 0, operaciones_sospechosas: 0 },
      historico_pct_gratuitos: historico,
    });

    if (metrics.nivel_riesgo === 'CRITICO') alertasCriticas++;
    else if (metrics.nivel_riesgo === 'AVISO') alertasAviso++;

    cajeros.push(metrics);
    totalVisitantes += metrics.total_persons;
    totalDeclarado  += metrics.ingresos_declarados;
    totalEsperado   += metrics.ingresos_esperados;
  }

  return {
    date: toLocalDateStr(dayStart),
    cajeros,
    totales: {
      total_visitantes: totalVisitantes,
      ingresos_declarados: totalDeclarado,
      ingresos_esperados: totalEsperado,
      brecha_total: Math.max(0, totalEsperado - totalDeclarado),
      alertas_criticas: alertasCriticas,
      alertas_aviso: alertasAviso,
    },
  };
}

// ─── Per-day history for a single cashier ────────────────────
// Same story as the metrics above: Postgres groups by day and returns one row
// per day instead of every ticket in the window.
async function getCashierDailyHistory({ cashierId, days }) {
  const today = startOfToday();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - days);

  const rows = await prisma.$queryRaw`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
           COUNT(*)::int AS total_persons,
           COUNT(*) FILTER (WHERE "visitor_type" = 'ADULT')::int AS adults,
           COUNT(*) FILTER (WHERE "visitor_type" IN (${Prisma.join(FREE_VISITOR_TYPES)}))::int AS free,
           COALESCE(SUM("price"), 0)::int AS declared
    FROM "Ticket"
    WHERE "createdById" = ${cashierId}
      AND "createdAt" >= ${startDate}
      AND "createdAt" < ${today}
      AND "status" IN (${Prisma.join(COUNTED_STATUSES)})
    GROUP BY 1
    ORDER BY 1
  `;

  let sumPct = 0;
  const history = rows.map((row) => {
    const pct = row.total_persons > 0 ? r2((row.free / row.total_persons) * 100) : 0;
    const expected = row.adults * ADULT_PRICE;
    sumPct += pct;
    return {
      date: row.date,
      pct_gratuitos: pct,
      total_persons: row.total_persons,
      ingresos_declarados: row.declared,
      ingresos_esperados: expected,
      brecha: Math.max(0, expected - row.declared),
    };
  });

  return {
    history,
    promedio_historico_pct_gratuitos: history.length > 0 ? r2(sumPct / history.length) : 0,
  };
}

// ─── Derive alerts from fraud metrics ────────────────────────
function deriveAlerts(fraudData, nivelFilter) {
  const alerts = [];

  for (const c of fraudData.cajeros) {
    // Condition 1: Income gap
    if (c.brecha_ingresos > 0) {
      alerts.push({
        id: `alert-${c.cajero_id}-brecha`,
        nivel: 'CRITICO',
        cajero_id: c.cajero_id,
        cajero_nombre: c.cajero_nombre,
        tipo: 'BRECHA_INGRESOS',
        mensaje: 'Brecha de ingresos detectada',
        detalle: `Esperado ₲${c.ingresos_esperados.toLocaleString()} — Declarado ₲${c.ingresos_declarados.toLocaleString()}. Diferencia: ₲${c.brecha_ingresos.toLocaleString()}`,
      });
    }

    // Condition 2: Extreme free ratio
    if (c.diferencia_pp >= PP_CRITICAL) {
      alerts.push({
        id: `alert-${c.cajero_id}-ratio-critico`,
        nivel: 'CRITICO',
        cajero_id: c.cajero_id,
        cajero_nombre: c.cajero_nombre,
        tipo: 'RATIO_GRATUITOS_CRITICO',
        mensaje: 'Ratio de gratuitos anómalo',
        detalle: `${c.pct_gratuitos_hoy}% hoy vs ${c.historico_pct_gratuitos}% histórico. Diferencia de ${c.diferencia_pp} puntos.`,
      });
    }

    // Condition 3: Elevated free ratio (warning only if not already critical)
    if (c.diferencia_pp >= PP_WARNING && c.diferencia_pp < PP_CRITICAL) {
      alerts.push({
        id: `alert-${c.cajero_id}-ratio-aviso`,
        nivel: 'AVISO',
        cajero_id: c.cajero_id,
        cajero_nombre: c.cajero_nombre,
        tipo: 'RATIO_GRATUITOS_ELEVADO',
        mensaje: 'Ratio de gratuitos elevado',
        detalle: `${c.pct_gratuitos_hoy}% hoy vs ${c.historico_pct_gratuitos}% histórico. Monitorear.`,
      });
    }

    // Condition 4: Multiple suspicious operations
    if (c.operaciones_sospechosas >= 3) {
      alerts.push({
        id: `alert-${c.cajero_id}-ops-sospechosas`,
        nivel: 'AVISO',
        cajero_id: c.cajero_id,
        cajero_nombre: c.cajero_nombre,
        tipo: 'OPERACIONES_SOSPECHOSAS',
        mensaje: 'Múltiples operaciones con mayoría gratuita',
        detalle: `${c.operaciones_sospechosas} grupos registrados con más gratuitos que adultos pagantes.`,
      });
    }
  }

  const filtered = nivelFilter ? alerts.filter(a => a.nivel === nivelFilter) : alerts;

  return {
    date: fraudData.date,
    alerts: filtered,
    total_criticas: filtered.filter(a => a.nivel === 'CRITICO').length,
    total_avisos: filtered.filter(a => a.nivel === 'AVISO').length,
  };
}

module.exports = {
  calculateCashierFraudMetrics,
  getCashierDailyHistory,
  deriveAlerts,
  // Exported for unit tests — pure, no DB.
  computeGlobalHistAvg,
  classifyRisk,
  buildCashierMetrics,
  indexTodayStats,
  resolveDay,
  toLocalDateStr,
  ADULT_PRICE,
  FREE_PCT_LIMIT,
  HISTORY_DAYS,
  PP_CRITICAL,
  PP_WARNING,
};
