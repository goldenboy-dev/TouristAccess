const prisma = require('../utils/prisma');
const { auditFromRequest, AUDIT_EVENTS } = require('../utils/audit');
const { startOfLocalDay, endOfLocalDay, startOfToday } = require('../utils/date');

// ─── DASHBOARD STATS ────────────────────────────────────────
const getStats = async (req, res, next) => {
  try {
    const { date_from, date_to } = req.query; // validated by Zod

    // A cashier only ever sees their own numbers.
    const isCashier = req.user.role === 'CASHIER';
    const baseWhere = isCashier ? { createdById: req.user.id } : {};

    const dateFilter = {};
    if (date_from) dateFilter.gte = startOfLocalDay(date_from);
    if (date_to)   dateFilter.lte = endOfLocalDay(date_to);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const periodFilter = hasDateFilter ? dateFilter : { gte: startOfToday() };
    const rangeFilter = { ...baseWhere, createdAt: periodFilter, status: { in: ['ACTIVE', 'USED'] } };

    const [
      totalTickets, activeTickets, usedTickets, cancelledTickets,
      ticketsSoldToday, usedTicketsToday,
      revenueAgg, rangeSumAgg, revenueByMethodRows, recentEntries,
    ] = await Promise.all([
      prisma.ticket.count({ where: baseWhere }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'USED' } }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'CANCELLED' } }),
      prisma.ticket.count({ where: { ...baseWhere, createdAt: periodFilter } }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'USED', updatedAt: periodFilter } }),
      prisma.ticket.aggregate({
        where: { ...baseWhere, status: { in: ['ACTIVE', 'USED'] } },
        _sum: { price: true },
      }),
      prisma.ticket.aggregate({ where: rangeFilter, _sum: { price: true } }),
      // Summed in the database: this used to fetch every ticket of the period
      // just to add up prices per payment method in JS.
      prisma.ticket.groupBy({
        by: ['payment_method'],
        where: rangeFilter,
        _sum: { price: true },
      }),
      prisma.scan.findMany({
        take: 15,
        where: isCashier ? { ticket: { createdById: req.user.id } } : {},
        orderBy: { scannedAt: 'desc' },
        include: {
          ticket: { select: { customer_name: true, visitor_type: true, payment_method: true } },
          guard: { select: { email: true } },
        },
      }),
    ]);

    const revenueByMethod = { CASH: 0, TRANSFER: 0, QR: 0, CARD: 0 };
    for (const row of revenueByMethodRows) {
      if (revenueByMethod[row.payment_method] !== undefined) {
        revenueByMethod[row.payment_method] = row._sum.price || 0;
      }
    }

    res.status(200).json({
      stats: {
        totalTickets,
        activeTickets,
        usedTickets,
        cancelledTickets,
        totalRevenue: revenueAgg._sum.price || 0,
        usedTicketsToday,
        ticketsSoldToday,
        revenueToday: rangeSumAgg._sum.price || 0,
        revenueByMethod,
      },
      recentEntries: recentEntries.map(s => ({
        customerName: s.ticket.customer_name,
        ticketType: s.ticket.visitor_type,
        paymentMethod: s.ticket.payment_method,
        guardEmail: s.guard.email,
        scannedAt: s.scannedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// ─── LIST USERS (ADMIN only) ────────────────────────────────
const getUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true, email: true, name: true, role: true, createdAt: true,
        _count: { select: { createdTickets: true, scans: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({ users });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE USER NAME (ADMIN only) ───────────────────────────
const updateUserName = async (req, res, next) => {
  try {
    const { name } = req.body; // validated + trimmed by Zod

    const updatedUser = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { name },
      select: { id: true, name: true, email: true },
    });

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.USER_NAME_UPDATED,
      resource_type: 'User',
      resource_id: updatedUser.id,
      metadata: { newName: updatedUser.name, targetEmail: updatedUser.email },
    });

    res.status(200).json({ message: 'Nombre actualizado correctamente', user: updatedUser });
  } catch (error) {
    next(error);
  }
};

// ─── AUDIT LOG (ADMIN only) ─────────────────────────────────
// A persisted trail is only useful if it can be read back. Filterable by
// event, actor, outcome and date range; paginated.
const getAuditLog = async (req, res, next) => {
  try {
    const { event, actor_id, outcome, resource_type, date_from, date_to, page, limit } = req.query;

    const where = {};
    if (event) where.event = event;
    if (resource_type) where.resource_type = resource_type;
    if (outcome) where.outcome = outcome;
    if (actor_id) where.actor_id = actor_id;

    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at.gte = startOfLocalDay(date_from);
      if (date_to)   where.created_at.lte = endOfLocalDay(date_to);
    }

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { actor: { select: { id: true, email: true, name: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.status(200).json({
      entries: entries.map(e => ({
        ...e,
        // Stored as a JSON string; hand the client an object.
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getStats, getUsers, updateUserName, getAuditLog };
