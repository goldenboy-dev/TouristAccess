const prisma = require('../src/utils/prisma');

(async () => {
  const t = await prisma.ticket.findMany({
    select: { id: true, createdAt: true, visit_date: true, visitor_type: true, createdById: true },
    take: 5
  });
  
  console.log('=== Sample Tickets ===');
  t.forEach(x => console.log(JSON.stringify({
    id: x.id,
    createdAt: x.createdAt,
    visit_date: x.visit_date,
    type: x.visitor_type,
    by: x.createdById
  })));

  const now = new Date();
  console.log('\n=== Date Analysis ===');
  console.log('Now (ISO):', now.toISOString());
  console.log('Now (local):', now.toString());
  
  // What the fraud service does:
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  
  console.log('Today start:', today.toISOString());
  console.log('Today end:', todayEnd.toISOString());
  
  const countToday = await prisma.ticket.count({
    where: { createdAt: { gte: today, lte: todayEnd } }
  });
  console.log('Tickets with createdAt in today range:', countToday);
  
  const countAll = await prisma.ticket.count();
  console.log('Total tickets in DB:', countAll);

  // Check cashiers
  const cashiers = await prisma.user.findMany({
    where: { role: 'CASHIER' },
    select: { id: true, email: true, name: true, role: true }
  });
  console.log('\n=== Cashiers ===');
  cashiers.forEach(c => console.log(JSON.stringify(c)));

  // Check what the fraud service would find
  const ticketsInRange = await prisma.ticket.findMany({
    where: {
      createdAt: { gte: today, lte: todayEnd },
      status: { in: ['ACTIVE', 'USED'] }
    },
    select: { id: true, visitor_type: true, createdById: true, createdAt: true }
  });
  console.log('\n=== Tickets matching fraud service filter ===');
  console.log('Count:', ticketsInRange.length);
  ticketsInRange.forEach(x => console.log(JSON.stringify(x)));

  await prisma.$disconnect();
})();
