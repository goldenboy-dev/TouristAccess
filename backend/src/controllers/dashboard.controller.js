const prisma = require('../utils/prisma');

const getStats = async (req, res) => {
  try {
    const { date_from, date_to } = req.query;

    // Build date range filter
    let dateFilter = {};
    if (date_from || date_to) {
      if (date_from) { const s = new Date(date_from); s.setHours(0, 0, 0, 0); dateFilter.gte = s; }
      if (date_to)   { const e = new Date(date_to);   e.setHours(23, 59, 59, 999); dateFilter.lte = e; }
    }
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const rangeStart = hasDateFilter ? (dateFilter.gte || null) : today;

    const [totalTickets, activeTickets, usedTickets, cancelledTickets, ticketsSoldToday, usedTicketsToday] = await Promise.all([
      prisma.ticket.count(),
      prisma.ticket.count({ where: { status: 'ACTIVE' } }),
      prisma.ticket.count({ where: { status: 'USED' } }),
      prisma.ticket.count({ where: { status: 'CANCELLED' } }),
      prisma.ticket.count({ where: { createdAt: hasDateFilter ? dateFilter : { gte: today } } }),
      prisma.ticket.count({ where: { status: 'USED', updatedAt: hasDateFilter ? dateFilter : { gte: today } } })
    ]);

    // Revenue
    const allPaidTickets = await prisma.ticket.findMany({
      where: { status: { in: ['ACTIVE', 'USED'] } }, select: { price: true }
    });
    const totalRevenue = allPaidTickets.reduce((s, t) => s + t.price, 0);

    const rangeFilter = hasDateFilter
      ? { createdAt: dateFilter, status: { in: ['ACTIVE', 'USED'] } }
      : { createdAt: { gte: today }, status: { in: ['ACTIVE', 'USED'] } };

    const todayPaidTickets = await prisma.ticket.findMany({ where: rangeFilter, select: { price: true, payment_method: true } });
    const revenueToday = todayPaidTickets.reduce((s, t) => s + t.price, 0);

    // Revenue by payment method (for range or today)
    const revenueByMethod = { CASH: 0, TRANSFER: 0, QR: 0, CARD: 0 };
    todayPaidTickets.forEach(t => {
      if (revenueByMethod[t.payment_method] !== undefined) revenueByMethod[t.payment_method] += t.price;
    });

    // Recent entries
    const recentEntries = await prisma.scan.findMany({
      take: 15,
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
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true, createdAt: true, _count: { select: { createdTickets: true, scans: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = { getStats, getUsers };
