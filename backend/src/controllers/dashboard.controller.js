const prisma = require('../utils/prisma');
const { logger } = require('../utils/logger');

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

    logger.info({ event: 'user.update_name', targetUserId: id, adminId: req.user.id, ip: req.ip, requestId: req.requestId });

    res.status(200).json({ message: 'Nombre actualizado correctamente', user: updatedUser });
  } catch (error) {
    next(error);
  }
};

module.exports = { getStats, getUsers, updateUserName };
