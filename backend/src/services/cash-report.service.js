/**
 * Cierre de caja: totales de ventas por cajero para un rango de fechas.
 *
 * Deliberadamente NO es una máquina de estados (abrir/cerrar turno) — es un
 * reporte agregado, mismo espíritu que fraud.service.js pero agrupando por
 * columnas reales (createdById, payment_method), así que alcanza con
 * `groupBy` de Prisma sin necesidad de SQL crudo.
 */
const prisma = require('../utils/prisma');
const { startOfLocalDay, endOfLocalDay, startOfToday } = require('../utils/date');
const { PAYMENT_METHODS, COUNTED_STATUSES } = require('../constants/ticket');

function emptyMethodTotals() {
  return PAYMENT_METHODS.reduce((acc, m) => ({ ...acc, [m]: 0 }), {});
}

async function getCashReport({ date_from, date_to, cajero_id }) {
  const visitDateFilter = {
    gte: date_from ? startOfLocalDay(date_from) : startOfToday(),
    lte: date_to ? endOfLocalDay(date_to) : endOfLocalDay(startOfToday()),
  };

  const baseWhere = { visit_date: visitDateFilter };
  if (cajero_id) baseWhere.createdById = cajero_id;

  const [soldRows, cancelledRows] = await Promise.all([
    prisma.ticket.groupBy({
      by: ['createdById', 'payment_method'],
      where: { ...baseWhere, status: { in: COUNTED_STATUSES } },
      _sum: { price: true },
      _count: { _all: true },
    }),
    prisma.ticket.groupBy({
      by: ['createdById'],
      where: { ...baseWhere, status: 'CANCELLED' },
      _count: { _all: true },
    }),
  ]);

  const cancelledByCashier = new Map(cancelledRows.map(r => [r.createdById, r._count._all]));

  const byCashier = new Map();
  for (const row of soldRows) {
    if (!byCashier.has(row.createdById)) {
      byCashier.set(row.createdById, {
        totalAmount: 0,
        totalTickets: 0,
        byMethod: emptyMethodTotals(),
      });
    }
    const entry = byCashier.get(row.createdById);
    const amount = row._sum.price || 0;
    entry.totalAmount += amount;
    entry.totalTickets += row._count._all;
    if (entry.byMethod[row.payment_method] !== undefined) {
      entry.byMethod[row.payment_method] += amount;
    }
  }

  // Whoever actually issued the tickets — usually a CASHIER, but ADMIN can
  // also sell (same route allows both roles), so resolve by the ids that
  // really show up in the data instead of assuming role === 'CASHIER'.
  const allIds = new Set([...byCashier.keys(), ...cancelledByCashier.keys()]);
  const sellers = allIds.size > 0
    ? await prisma.user.findMany({ where: { id: { in: [...allIds] } }, select: { id: true, email: true, name: true } })
    : [];
  const cashierNameById = new Map(sellers.map(c => [c.id, c.name || c.email.split('@')[0]]));
  const cashierEmailById = new Map(sellers.map(c => [c.id, c.email]));

  const rows = [...byCashier.entries()]
    .filter(([cashierId]) => !cajero_id || cashierId === cajero_id)
    .map(([cashierId, entry]) => ({
      cajeroId: cashierId,
      cajeroNombre: cashierNameById.get(cashierId) || `#${cashierId}`,
      cajeroEmail: cashierEmailById.get(cashierId) || null,
      totalAmount: entry.totalAmount,
      totalTickets: entry.totalTickets,
      byMethod: entry.byMethod,
      cancelledCount: cancelledByCashier.get(cashierId) || 0,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const grandTotal = rows.reduce((sum, r) => sum + r.totalAmount, 0);
  const grandTotalTickets = rows.reduce((sum, r) => sum + r.totalTickets, 0);

  return { rows, grandTotal, grandTotalTickets };
}

module.exports = { getCashReport };
