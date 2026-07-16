const prisma = require('../utils/prisma');
const { logger } = require('../utils/logger');
const { auditFromRequest, AUDIT_EVENTS } = require('../utils/audit');

const AUDIT_MAX_LIMIT = 200;

// ─── DASHBOARD STATS ────────────────────────────────────────
const getStats = async (req, res, next) => {
  try {
    const { date_from, date_to } = req.query;

    // [IDOR FIX] Cashier should only see their own stats
    const isCashier = req.user.role === 'CASHIER';
    const baseWhere = isCashier ? { createdById: req.user.id } : {};

    // Build date range filter
    let dateFilter = {};
    if (date_from || date_to) {
      if (date_from) { const s = new Date(date_from); s.setHours(0, 0, 0, 0); dateFilter.gte = s; }
      if (date_to)   { const e = new Date(date_to);   e.setHours(23, 59, 59, 999); dateFilter.lte = e; }
    }
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    
    // Stats with IDOR filtering
    const [totalTickets, activeTickets, usedTickets, cancelledTickets, ticketsSoldToday, usedTicketsToday] = await Promise.all([
      prisma.ticket.count({ where: baseWhere }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'USED' } }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'CANCELLED' } }),
      prisma.ticket.count({ where: { ...baseWhere, createdAt: hasDateFilter ? dateFilter : { gte: today } } }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'USED', updatedAt: hasDateFilter ? dateFilter : { gte: today } } })
    ]);

    // Revenue via aggregate with IDOR filtering
    const revenueAgg = await prisma.ticket.aggregate({
      where: { ...baseWhere, status: { in: ['ACTIVE', 'USED'] } },
      _sum: { price: true }
    });
    const totalRevenue = revenueAgg._sum.price || 0;

    const rangeFilter = hasDateFilter
      ? { ...baseWhere, createdAt: dateFilter, status: { in: ['ACTIVE', 'USED'] } }
      : { ...baseWhere, createdAt: { gte: today }, status: { in: ['ACTIVE', 'USED'] } };

    const rangeSumAgg = await prisma.ticket.aggregate({
      where: rangeFilter,
      _sum: { price: true }
    });
    const revenueToday = rangeSumAgg._sum.price || 0;

    const todayPaidTickets = await prisma.ticket.findMany({ 
      where: rangeFilter, 
      select: { price: true, payment_method: true } 
    });

    const revenueByMethod = { CASH: 0, TRANSFER: 0, QR: 0, CARD: 0 };
    todayPaidTickets.forEach(t => {
      if (revenueByMethod[t.payment_method] !== undefined) revenueByMethod[t.payment_method] += t.price;
    });

    // Recent entries (IDOR filtering for scans)
    const scanWhere = isCashier ? { ticket: { createdById: req.user.id } } : {};
    const recentEntries = await prisma.scan.findMany({
      take: 15,
      where: scanWhere,
      orderBy: { scannedAt: 'desc' },
      include: {
        ticket: { select: { customer_name: true, visitor_type: true, payment_method: true } },
        guard: { select: { email: true } }
      }
    });

    res.status(200).json({
      stats: { totalTickets, activeTickets, usedTickets, cancelledTickets, totalRevenue, usedTicketsToday, ticketsSoldToday, revenueToday, revenueByMethod },
      recentEntries: recentEntries.map(s => ({
        customerName: s.ticket.customer_name,
        ticketType: s.ticket.visitor_type,
        paymentMethod: s.ticket.payment_method,
        guardEmail: s.guard.email,
        scannedAt: s.scannedAt
      }))
    });
  } catch (error) {
    next(error);
  }
};

// ─── LIST USERS (ADMIN only) ────────────────────────────────
const getUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true, _count: { select: { createdTickets: true, scans: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ users });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE USER NAME (ADMIN only) ───────────────────────────
const updateUserName = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ message: 'El nombre debe tener al menos 2 caracteres' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: parseInt(id) },
      data: { name: name.trim() },
      select: { id: true, name: true, email: true }
    });

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.USER_NAME_UPDATED,
      resource_type: 'User',
      resource_id: updatedUser.id,
      metadata: { newName: updatedUser.name, targetEmail: updatedUser.email }
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
    const { event, actor_id, outcome, resource_type, date_from, date_to } = req.query;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(AUDIT_MAX_LIMIT, Math.max(1, parseInt(req.query.limit) || 50));

    const where = {};
    if (event) where.event = event;
    if (resource_type) where.resource_type = resource_type;
    if (outcome && ['SUCCESS', 'FAILURE'].includes(outcome)) where.outcome = outcome;

    const actorId = parseInt(actor_id);
    if (!isNaN(actorId)) where.actor_id = actorId;

    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) { const s = new Date(date_from); s.setHours(0, 0, 0, 0); where.created_at.gte = s; }
      if (date_to)   { const e = new Date(date_to);   e.setHours(23, 59, 59, 999); where.created_at.lte = e; }
    }

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { actor: { select: { id: true, email: true, name: true, role: true } } }
      }),
      prisma.auditLog.count({ where })
    ]);

    res.status(200).json({
      entries: entries.map(e => ({
        ...e,
        // Stored as a JSON string; hand the client an object.
        metadata: e.metadata ? JSON.parse(e.metadata) : null
      })),
      total,
      page,
      limit
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getStats, getUsers, updateUserName, getAuditLog };
