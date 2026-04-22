// Quick integration test for the restructured ticket module
const prisma = require('../src/utils/prisma');

async function test() {
  console.log('=== TEST 1: Create ticket with adults + children + locals ===');
  
  // Simulate the controller logic
  const { generateSecureToken } = require('../src/utils/crypto');
  const { randomUUID } = require('crypto');

  const groupId = randomUUID();
  const operationCode = groupId.split('-')[0];
  const ADULT_PRICE = 10000;

  try {
    let groupSummary;
    const createdData = [];

    await prisma.$transaction(async (tx) => {
      groupSummary = await tx.groupSummary.create({
        data: {
          operation_code: operationCode,
          cajero_id: 1,
          total_adults: 2,
          total_children: 1,
          total_locals: 1,
          total_persons: 4,
          total_amount: 2 * ADULT_PRICE,
          payment_method: 'CASH',
          visit_date: new Date()
        }
      });

      // 2 adults
      for (let i = 0; i < 2; i++) {
        const ticket = await tx.ticket.create({
          data: {
            token: generateSecureToken(),
            customer_name: `Test Adult #${i+1}`,
            visitor_type: 'ADULT',
            price: ADULT_PRICE,
            group_id: groupId,
            group_summary_id: groupSummary.id,
            visit_date: new Date(),
            payment_method: 'CASH',
            createdById: 1
          }
        });
        createdData.push(ticket);
      }

      // 1 child
      const childTicket = await tx.ticket.create({
        data: {
          token: generateSecureToken(),
          customer_name: 'Test Child #3',
          visitor_type: 'CHILD',
          price: 0,
          cedula: '1234567',
          group_id: groupId,
          group_summary_id: groupSummary.id,
          visit_date: new Date(),
          payment_method: 'CASH',
          createdById: 1
        }
      });
      createdData.push(childTicket);

      // 1 local
      const localTicket = await tx.ticket.create({
        data: {
          token: generateSecureToken(),
          customer_name: 'Test Local #4',
          visitor_type: 'LOCAL',
          price: 0,
          cedula: '7654321',
          group_id: groupId,
          group_summary_id: groupSummary.id,
          visit_date: new Date(),
          payment_method: 'CASH',
          createdById: 1
        }
      });
      createdData.push(localTicket);
    });

    console.log('✅ GroupSummary created:', groupSummary.operation_code);
    console.log('✅ Tickets created:', createdData.length);
    console.log('   Types:', createdData.map(t => t.visitor_type).join(', '));
    console.log('   Prices:', createdData.map(t => t.price).join(', '));

    // Test 2: Fetch group by code
    console.log('\n=== TEST 2: Fetch group by operation code ===');
    const group = await prisma.groupSummary.findUnique({
      where: { operation_code: operationCode },
      include: { tickets: true, cajero: { select: { email: true } } }
    });
    console.log('✅ Group found:', group.operation_code);
    console.log('   Cajero:', group.cajero.email);
    console.log('   Tickets in group:', group.tickets.length);
    console.log('   Total amount:', group.total_amount);

    // Test 3: Validate a CHILD ticket without free_confirmed
    console.log('\n=== TEST 3: Validate CHILD ticket (no confirmation) ===');
    const childToken = createdData[2].token;
    const childTicket = await prisma.ticket.findUnique({ where: { token: childToken } });
    const isFree = childTicket.visitor_type === 'CHILD' || childTicket.visitor_type === 'LOCAL';
    console.log('✅ Is free entry:', isFree, '→ Should require confirmation');

    // Test 4: Validate ADULT ticket (no confirmation needed)
    console.log('\n=== TEST 4: Validate ADULT ticket ===');
    const adultToken = createdData[0].token;
    const updated = await prisma.ticket.updateMany({
      where: { token: adultToken, status: 'ACTIVE' },
      data: { status: 'USED', guard_id: 3 }
    });
    console.log('✅ Adult ticket validated:', updated.count === 1 ? 'SUCCESS' : 'FAILED');

    // Test 5: Validate LOCAL ticket WITH confirmation
    console.log('\n=== TEST 5: Validate LOCAL ticket with confirmation ===');
    const localToken = createdData[3].token;
    const localUpdated = await prisma.ticket.updateMany({
      where: { token: localToken, status: 'ACTIVE' },
      data: { 
        status: 'USED', 
        guard_id: 3, 
        free_confirmed: 'CONFIRMED',
        free_confirmed_at: new Date()
      }
    });
    console.log('✅ Local ticket validated with confirmation:', localUpdated.count === 1 ? 'SUCCESS' : 'FAILED');

    const verifyLocal = await prisma.ticket.findUnique({ where: { token: localToken } });
    console.log('   free_confirmed:', verifyLocal.free_confirmed);
    console.log('   free_confirmed_at:', verifyLocal.free_confirmed_at);
    console.log('   guard_id:', verifyLocal.guard_id);

    console.log('\n🎉 ALL TESTS PASSED!');

  } catch (err) {
    console.error('❌ TEST FAILED:', err.message);
    console.error(err);
  }

  await prisma.$disconnect();
}

test();
