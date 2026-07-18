const prisma = require('../utils/prisma');
const {
  calculateCashierFraudMetrics,
  getCashierDailyHistory,
  deriveAlerts,
  resolveDay,
  toLocalDateStr,
  FREE_PCT_LIMIT,
} = require('../services/fraud.service');
const fraudAlertService = require('../services/fraud-alert.service');
const { auditFromRequest, AUDIT_EVENTS } = require('../utils/audit');
const { notFound } = require('../utils/errors');

// ─── GET /api/dashboard/fraud-summary ────────────────────────
const getFraudSummary = async (req, res, next) => {
  try {
    const data = await calculateCashierFraudMetrics(req.query.date);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/dashboard/alerts ───────────────────────────────
// Persists the day's derived alerts (upsert, keyed by the same synthetic id
// deriveAlerts already builds) so a status set from the history panel shows
// up here too, and survives the next 60s auto-refresh.
const getAlerts = async (req, res, next) => {
  try {
    const { date, nivel } = req.query;
    const fraudData = await calculateCashierFraudMetrics(date);

    const allAlerts = deriveAlerts(fraudData, null).alerts;
    const persisted = await fraudAlertService.persistAlerts(fraudData.date, allAlerts);
    const persistedByKey = new Map(persisted.map((p) => [p.alert_key, p]));

    const result = deriveAlerts(fraudData, nivel || null);
    result.alerts = result.alerts.map((a) => {
      const p = persistedByKey.get(a.id);
      return p ? { ...a, db_id: p.id, status: p.status } : a;
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/dashboard/alerts-history ───────────────────────
const getAlertsHistory = async (req, res, next) => {
  try {
    const { status, nivel, cajero_id, date_from, date_to, page, limit } = req.query;
    const result = await fraudAlertService.listAlertHistory({ status, nivel, cajero_id, date_from, date_to, page, limit });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// ─── PATCH /api/dashboard/alerts-history/:id/status ──────────
const updateAlertStatus = async (req, res, next) => {
  try {
    const { status, note } = req.body; // validated by Zod
    const { previous, updated } = await fraudAlertService.updateAlertStatus({
      id: parseInt(req.params.id),
      status,
      note,
      reviewedById: req.user.id,
    });

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.FRAUD_ALERT_STATUS_UPDATED,
      resource_type: 'FraudAlert',
      resource_id: updated.id,
      metadata: { alertKey: previous.alert_key, previousStatus: previous.status, newStatus: status, note: note || undefined },
    });

    res.status(200).json({ message: 'Estado actualizado correctamente', alert: updated });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/dashboard/gratuitos-evolution ───────────────────
const getGratuitosEvolution = async (req, res, next) => {
  try {
    const { date, interval_minutes: interval } = req.query;
    const { dayStart, dayEnd } = resolveDay(date);

    // Bounded by one day of sales, so the rows are fetched and bucketed here
    // rather than in SQL — the buckets are wall-clock local time, which the
    // database would have to be told about anyway.
    const tickets = await prisma.ticket.findMany({
      where: {
        createdAt: { gte: dayStart, lte: dayEnd },
        status: { in: ['ACTIVE', 'USED'] },
      },
      select: { visitor_type: true, createdById: true, createdAt: true },
    });

    const cashierIds = [...new Set(tickets.map(t => t.createdById))];
    const cashiers = await prisma.user.findMany({
      where: { id: { in: cashierIds }, role: 'CASHIER' },
      select: { id: true, name: true, email: true },
    });

    // Build time blocks (operating hours)
    const blocks = [];
    for (let h = 7; h <= 20; h++) {
      for (let m = 0; m < 60; m += interval) {
        blocks.push({ hour: h, minute: m, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` });
      }
    }

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
          pct_gratuitos: total > 0 ? Math.round((free / total) * 10000) / 100 : 0,
          total,
        };
      });

      return {
        cajero_id: cashier.id,
        cajero_nombre: cashier.name || cashier.email.split('@')[0],
        data,
      };
    });

    res.status(200).json({
      date: toLocalDateStr(dayStart),
      interval_minutes: interval,
      limit_pct: FREE_PCT_LIMIT,
      series,
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/dashboard/suspicious-operations ────────────────
const getSuspiciousOperations = async (req, res, next) => {
  try {
    const { date, cajero_id } = req.query;
    const { dayStart, dayEnd } = resolveDay(date);

    const where = { createdAt: { gte: dayStart, lte: dayEnd } };
    if (cajero_id) where.cajero_id = cajero_id;

    const groups = await prisma.groupSummary.findMany({
      where,
      include: { cajero: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
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
          : null,
      };
    });

    res.status(200).json({
      date: toLocalDateStr(dayStart),
      operations,
      total: operations.length,
      total_sospechosas: operations.filter(o => o.sospechoso).length,
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/dashboard/cashier-history ──────────────────────
const getCashierHistory = async (req, res, next) => {
  try {
    const { cajero_id, days } = req.query;

    const cashier = await prisma.user.findUnique({
      where: { id: cajero_id },
      select: { id: true, name: true, email: true },
    });
    if (!cashier) throw notFound('Cajero no encontrado');

    const { history, promedio_historico_pct_gratuitos } = await getCashierDailyHistory({
      cashierId: cajero_id,
      days,
    });

    res.status(200).json({
      cajero_id: cashier.id,
      cajero_nombre: cashier.name || cashier.email.split('@')[0],
      days,
      promedio_historico_pct_gratuitos,
      history,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getFraudSummary, getAlerts, getAlertsHistory, updateAlertStatus,
  getGratuitosEvolution, getSuspiciousOperations, getCashierHistory,
};
