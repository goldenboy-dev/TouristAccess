const prisma = require('../utils/prisma');
const { calculateCashierFraudMetrics, deriveAlerts, ADULT_PRICE, FREE_PCT_LIMIT } = require('../services/fraud.service');
const { logger } = require('../utils/logger');

// Helper: parse YYYY-MM-DD as local time (avoids UTC offset bug)
function parseDateLocal(dateStr) {
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return { start: new Date(y, m - 1, d, 0, 0, 0, 0), end: new Date(y, m - 1, d, 23, 59, 59, 999) };
  }
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(); e.setHours(23, 59, 59, 999);
  return { start: s, end: e };
}
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── GET /api/dashboard/fraud-summary ────────────────────────
const getFraudSummary = async (req, res, next) => {
  try {
    const { date } = req.query;
    const data = await calculateCashierFraudMetrics(date);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/dashboard/alerts ───────────────────────────────
const getAlerts = async (req, res, next) => {
  try {
    const { date, nivel } = req.query;
    const fraudData = await calculateCashierFraudMetrics(date);
    const alertsData = deriveAlerts(fraudData, nivel || null);
    res.status(200).json(alertsData);
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/dashboard/gratuitos-evolution ───────────────────
const getGratuitosEvolution = async (req, res, next) => {
  try {
    const { date, interval_minutes = 60 } = req.query;
    const { start: dayStart, end: dayEnd } = parseDateLocal(date);
    const interval = parseInt(interval_minutes) || 60;

    // Get tickets for the day
    const tickets = await prisma.ticket.findMany({
      where: {
        createdAt: { gte: dayStart, lte: dayEnd },
        status: { in: ['ACTIVE', 'USED'] }
      },
      select: {
        visitor_type: true, createdById: true, createdAt: true
      }
    });

    // Get cashiers who have tickets
    const cashierIds = [...new Set(tickets.map(t => t.createdById))];
    const cashiers = await prisma.user.findMany({
      where: { id: { in: cashierIds }, role: 'CASHIER' },
      select: { id: true, name: true, email: true }
    });

    // Build time blocks
    const blocks = [];
    for (let h = 7; h <= 20; h++) {
      for (let m = 0; m < 60; m += interval) {
        blocks.push({ hour: h, minute: m, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` });
      }
    }

    // Group tickets by cashier and time block
    const series = cashiers.map(cashier => {
      const cashierTickets = tickets.filter(t => t.createdById === cashier.id);

      const data = blocks.map(block => {
        const blockStart = new Date(dayStart);
        blockStart.setHours(block.hour, block.minute, 0, 0);
        const blockEnd = new Date(blockStart);
        blockEnd.setMinutes(blockEnd.getMinutes() + interval);

        const inBlock = cashierTickets.filter(t => t.createdAt >= blockStart && t.createdAt < blockEnd);
        const total = inBlock.length;
        const free = inBlock.filter(t => t.visitor_type === 'CHILD' || t.visitor_type === 'LOCAL').length;

        return {
          hora: block.label,
          pct_gratuitos: total > 0 ? Math.round((free / total) * 100 * 100) / 100 : 0,
          total
        };
      });

      return {
        cajero_id: cashier.id,
        cajero_nombre: cashier.name || cashier.email.split('@')[0],
        data
      };
    });

    res.status(200).json({
      date: toLocalDateStr(dayStart),
      interval_minutes: interval,
      limit_pct: FREE_PCT_LIMIT,
      series
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/dashboard/suspicious-operations ────────────────
const getSuspiciousOperations = async (req, res, next) => {
  try {
    const { date, cajero_id } = req.query;
    const { start: dayStart, end: dayEnd } = parseDateLocal(date);

    const where = { createdAt: { gte: dayStart, lte: dayEnd } };
    if (cajero_id) where.cajero_id = parseInt(cajero_id);

    const groups = await prisma.groupSummary.findMany({
      where,
      include: { cajero: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' }
    });

    const operations = groups.map(g => {
      const sospechoso = (g.total_children + g.total_locals) >= g.total_adults;
      return {
        operation_code: g.operation_code,
        cajero_id: g.cajero_id,
        cajero_nombre: g.cajero.name || g.cajero.email.split('@')[0],
        created_at: g.createdAt,
        hora: g.createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        total_adults: g.total_adults,
        total_children: g.total_children,
        total_locals: g.total_locals,
        total_amount: g.total_amount,
        sospechoso,
        razon: sospechoso
          ? `${g.total_children + g.total_locals} gratuitos para ${g.total_adults} adulto${g.total_adults !== 1 ? 's' : ''} pagante${g.total_adults !== 1 ? 's' : ''}`
          : null
      };
    });

    res.status(200).json({
      date: toLocalDateStr(dayStart),
      operations,
      total: operations.length,
      total_sospechosas: operations.filter(o => o.sospechoso).length
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/dashboard/cashier-history ──────────────────────
const getCashierHistory = async (req, res, next) => {
  try {
    const { cajero_id, days = 30 } = req.query;
    if (!cajero_id) return res.status(400).json({ message: 'cajero_id is required' });

    const cashier = await prisma.user.findUnique({
      where: { id: parseInt(cajero_id) },
      select: { id: true, name: true, email: true }
    });
    if (!cashier) return res.status(404).json({ message: 'Cashier not found' });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - parseInt(days));

    const tickets = await prisma.ticket.findMany({
      where: {
        createdById: parseInt(cajero_id),
        createdAt: { gte: startDate, lt: today },
        status: { in: ['ACTIVE', 'USED'] }
      },
      select: { visitor_type: true, price: true, createdAt: true }
    });

    // Group by day
    const dayMap = {};
    for (const t of tickets) {
      const dayKey = t.createdAt.toISOString().slice(0, 10);
      if (!dayMap[dayKey]) dayMap[dayKey] = { adults: 0, children: 0, locals: 0, total: 0, declared: 0 };
      dayMap[dayKey].total++;
      dayMap[dayKey].declared += t.price;
      if (t.visitor_type === 'ADULT') dayMap[dayKey].adults++;
      else if (t.visitor_type === 'CHILD') dayMap[dayKey].children++;
      else if (t.visitor_type === 'LOCAL') dayMap[dayKey].locals++;
    }

    const history = [];
    let sumPct = 0;
    for (const [date, d] of Object.entries(dayMap).sort()) {
      const free = d.children + d.locals;
      const pct = d.total > 0 ? Math.round((free / d.total) * 100 * 100) / 100 : 0;
      const expected = d.adults * ADULT_PRICE;
      sumPct += pct;
      history.push({
        date,
        pct_gratuitos: pct,
        total_persons: d.total,
        ingresos_declarados: d.declared,
        ingresos_esperados: expected,
        brecha: Math.max(0, expected - d.declared)
      });
    }

    res.status(200).json({
      cajero_id: cashier.id,
      cajero_nombre: cashier.name || cashier.email.split('@')[0],
      days: parseInt(days),
      promedio_historico_pct_gratuitos: history.length > 0 ? Math.round((sumPct / history.length) * 100) / 100 : 0,
      history
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getFraudSummary, getAlerts, getGratuitosEvolution, getSuspiciousOperations, getCashierHistory };
