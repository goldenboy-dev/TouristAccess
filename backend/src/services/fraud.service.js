const prisma = require('../utils/prisma');

// ─── Config from env ─────────────────────────────────────────
const ADULT_PRICE       = parseInt(process.env.ADULT_PRICE) || 10000;
const PP_CRITICAL       = parseInt(process.env.ALERT_FREE_PP_CRITICAL) || 20;
const PP_WARNING        = parseInt(process.env.ALERT_FREE_PP_WARNING) || 10;
const HISTORY_DAYS      = parseInt(process.env.HISTORY_DAYS) || 30;
const FREE_PCT_LIMIT    = parseInt(process.env.ALERT_FREE_PCT_LIMIT) || 25;

// ─── Helper: round to 2 decimals ─────────────────────────────
function r2(n) { return Math.round(n * 100) / 100; }

// ─── Core: Calculate fraud metrics for all cashiers on a date ─
async function calculateCashierFraudMetrics(dateStr) {
  // Parse date in LOCAL time to avoid UTC offset issues
  // new Date("2026-04-22") gives UTC midnight, but setHours(0) then shifts to local → wrong day
  let dayStart, dayEnd;
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
    dayEnd   = new Date(y, m - 1, d, 23, 59, 59, 999);
  } else {
    dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    dayEnd   = new Date(); dayEnd.setHours(23, 59, 59, 999);
  }

  // 1. Get all tickets for the date, grouped by cashier
  const tickets = await prisma.ticket.findMany({
    where: {
      createdAt: { gte: dayStart, lte: dayEnd },
      status: { in: ['ACTIVE', 'USED'] }
    },
    select: {
      id: true, visitor_type: true, price: true, createdById: true, createdAt: true
    }
  });

  // 2. Get all cashier users
  const cashiers = await prisma.user.findMany({
    where: { role: 'CASHIER' },
    select: { id: true, email: true, name: true }
  });

  // 3. Get suspicious operations for the date
  const groupSummaries = await prisma.groupSummary.findMany({
    where: {
      createdAt: { gte: dayStart, lte: dayEnd }
    },
    select: {
      id: true, cajero_id: true, total_adults: true, total_children: true,
      total_locals: true, total_persons: true, total_amount: true,
      operation_code: true, createdAt: true
    }
  });

  // 4. Historical data (last HISTORY_DAYS days, excluding current date)
  const histStart = new Date(dayStart);
  histStart.setDate(histStart.getDate() - HISTORY_DAYS);
  const histEnd = new Date(dayStart);
  histEnd.setMilliseconds(-1); // day before current

  const historicalTickets = await prisma.ticket.findMany({
    where: {
      createdAt: { gte: histStart, lte: histEnd },
      status: { in: ['ACTIVE', 'USED'] }
    },
    select: {
      visitor_type: true, createdById: true, createdAt: true
    }
  });

  // 5. Calculate historical pct per cashier per day
  const histByCashierDay = {};
  for (const t of historicalTickets) {
    const dayKey = t.createdAt.toISOString().slice(0, 10);
    const key = `${t.createdById}-${dayKey}`;
    if (!histByCashierDay[key]) histByCashierDay[key] = { total: 0, free: 0, cashierId: t.createdById };
    histByCashierDay[key].total++;
    if (t.visitor_type === 'CHILD' || t.visitor_type === 'LOCAL') histByCashierDay[key].free++;
  }

  // Average pct per cashier
  const histAvgByCashier = {};
  for (const entry of Object.values(histByCashierDay)) {
    if (!histAvgByCashier[entry.cashierId]) histAvgByCashier[entry.cashierId] = [];
    histAvgByCashier[entry.cashierId].push(entry.total > 0 ? (entry.free / entry.total) * 100 : 0);
  }

  // Global average
  const allHistPcts = Object.values(histAvgByCashier).flat();
  const globalHistAvg = allHistPcts.length > 0
    ? allHistPcts.reduce((s, v) => s + v, 0) / allHistPcts.length
    : 15; // default reference if no history at all

  // 6. Build metrics per cashier
  const ticketsByCashier = {};
  for (const t of tickets) {
    if (!ticketsByCashier[t.createdById]) ticketsByCashier[t.createdById] = [];
    ticketsByCashier[t.createdById].push(t);
  }

  const groupsByCashier = {};
  for (const g of groupSummaries) {
    if (!groupsByCashier[g.cajero_id]) groupsByCashier[g.cajero_id] = [];
    groupsByCashier[g.cajero_id].push(g);
  }

  const cajeros = [];
  let totalVisitantes = 0, totalDeclarado = 0, totalEsperado = 0;
  let alertasCriticas = 0, alertasAviso = 0;

  for (const cashier of cashiers) {
    const ct = ticketsByCashier[cashier.id] || [];
    if (ct.length === 0) continue; // skip cashiers with no activity

    const total_adults   = ct.filter(t => t.visitor_type === 'ADULT').length;
    const total_children = ct.filter(t => t.visitor_type === 'CHILD').length;
    const total_locals   = ct.filter(t => t.visitor_type === 'LOCAL').length;
    const total_gratuitos = total_children + total_locals;
    const total_persons  = ct.length;

    const pct_gratuitos_hoy = total_persons > 0 ? r2((total_gratuitos / total_persons) * 100) : 0;

    const ingresos_esperados  = total_adults * ADULT_PRICE;
    const ingresos_declarados = ct.reduce((s, t) => s + t.price, 0);

    let brecha_ingresos = ingresos_esperados - ingresos_declarados;
    if (brecha_ingresos < 0) {
      console.warn(`[FRAUD] Negative gap for cashier ${cashier.id}: ${brecha_ingresos}. Setting to 0.`);
      brecha_ingresos = 0;
    }

    // Historical average for this cashier
    const cashierHist = histAvgByCashier[cashier.id];
    const historico_pct_gratuitos = cashierHist && cashierHist.length > 0
      ? r2(cashierHist.reduce((s, v) => s + v, 0) / cashierHist.length)
      : r2(globalHistAvg);

    const diferencia_pp = r2(pct_gratuitos_hoy - historico_pct_gratuitos);

    // Risk level
    let nivel_riesgo;
    if (brecha_ingresos > 0 || diferencia_pp >= PP_CRITICAL) {
      nivel_riesgo = 'CRITICO';
      alertasCriticas++;
    } else if (diferencia_pp >= PP_WARNING) {
      nivel_riesgo = 'AVISO';
      alertasAviso++;
    } else {
      nivel_riesgo = 'NORMAL';
    }

    // Suspicious operations
    const cashierGroups = groupsByCashier[cashier.id] || [];
    const operaciones_sospechosas = cashierGroups.filter(
      g => (g.total_children + g.total_locals) >= g.total_adults
    ).length;

    cajeros.push({
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
      nivel_riesgo,
      total_operaciones: cashierGroups.length,
      operaciones_sospechosas
    });

    totalVisitantes += total_persons;
    totalDeclarado  += ingresos_declarados;
    totalEsperado   += ingresos_esperados;
  }

  const dateStr2 = `${dayStart.getFullYear()}-${String(dayStart.getMonth()+1).padStart(2,'0')}-${String(dayStart.getDate()).padStart(2,'0')}`;

  return {
    date: dateStr2,
    cajeros,
    totales: {
      total_visitantes: totalVisitantes,
      ingresos_declarados: totalDeclarado,
      ingresos_esperados: totalEsperado,
      brecha_total: Math.max(0, totalEsperado - totalDeclarado),
      alertas_criticas: alertasCriticas,
      alertas_aviso: alertasAviso
    }
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

  // Filter by nivel if specified
  const filtered = nivelFilter
    ? alerts.filter(a => a.nivel === nivelFilter)
    : alerts;

  return {
    date: fraudData.date,
    alerts: filtered,
    total_criticas: filtered.filter(a => a.nivel === 'CRITICO').length,
    total_avisos: filtered.filter(a => a.nivel === 'AVISO').length
  };
}

module.exports = {
  calculateCashierFraudMetrics,
  deriveAlerts,
  ADULT_PRICE,
  FREE_PCT_LIMIT,
  HISTORY_DAYS
};
