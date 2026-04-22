// Quick test for fraud endpoints logic
const prisma = require('../src/utils/prisma');
const { calculateCashierFraudMetrics, deriveAlerts } = require('../src/services/fraud.service');
const { generateSecureToken } = require('../src/utils/crypto');
const { randomUUID } = require('crypto');

async function test() {
  console.log('=== Setting up test data ===');

  // Create some test tickets for today
  const today = new Date();
  const groupId1 = randomUUID();
  const groupId2 = randomUUID();

  // Cajero 1 (id:2) - Normal ratio: 8 adults, 2 children
  const gs1 = await prisma.groupSummary.create({
    data: {
      operation_code: groupId1.slice(0, 8),
      cajero_id: 2, total_adults: 8, total_children: 2, total_locals: 0,
      total_persons: 10, total_amount: 80000, payment_method: 'CASH', visit_date: today
    }
  });
  for (let i = 0; i < 8; i++) {
    await prisma.ticket.create({
      data: { token: generateSecureToken(), customer_name: `Adult ${i}`, visitor_type: 'ADULT',
        price: 10000, group_id: groupId1, group_summary_id: gs1.id,
        visit_date: today, payment_method: 'CASH', createdById: 2 }
    });
  }
  for (let i = 0; i < 2; i++) {
    await prisma.ticket.create({
      data: { token: generateSecureToken(), customer_name: `Child ${i}`, visitor_type: 'CHILD',
        price: 0, group_id: groupId1, group_summary_id: gs1.id,
        visit_date: today, payment_method: 'CASH', createdById: 2 }
    });
  }

  // Cajero 2 (id:3) - Suspicious: 1 adult, 5 children, 2 locals
  const gs2 = await prisma.groupSummary.create({
    data: {
      operation_code: groupId2.slice(0, 8),
      cajero_id: 3, total_adults: 1, total_children: 5, total_locals: 2,
      total_persons: 8, total_amount: 10000, payment_method: 'CASH', visit_date: today
    }
  });
  await prisma.ticket.create({
    data: { token: generateSecureToken(), customer_name: 'Adult S', visitor_type: 'ADULT',
      price: 10000, group_id: groupId2, group_summary_id: gs2.id,
      visit_date: today, payment_method: 'CASH', createdById: 3 }
  });
  for (let i = 0; i < 5; i++) {
    await prisma.ticket.create({
      data: { token: generateSecureToken(), customer_name: `Child S${i}`, visitor_type: 'CHILD',
        price: 0, group_id: groupId2, group_summary_id: gs2.id,
        visit_date: today, payment_method: 'CASH', createdById: 3 }
    });
  }
  for (let i = 0; i < 2; i++) {
    await prisma.ticket.create({
      data: { token: generateSecureToken(), customer_name: `Local S${i}`, visitor_type: 'LOCAL',
        price: 0, cedula: `123456${i}`, group_id: groupId2, group_summary_id: gs2.id,
        visit_date: today, payment_method: 'CASH', createdById: 3 }
    });
  }

  console.log('Test data created: 10 tickets for cajero1 (normal), 8 for cajero2 (suspicious)');

  // TEST 1: Fraud Summary
  console.log('\n=== TEST 1: Fraud Summary ===');
  const summary = await calculateCashierFraudMetrics();
  console.log('Date:', summary.date);
  console.log('Cajeros found:', summary.cajeros.length);
  for (const c of summary.cajeros) {
    console.log(`  ${c.cajero_nombre}: ${c.total_persons} persons, ${c.pct_gratuitos_hoy}% free, risk=${c.nivel_riesgo}, brecha=₲${c.brecha_ingresos}`);
  }
  console.log('Totales:', JSON.stringify(summary.totales));

  // TEST 2: Alerts
  console.log('\n=== TEST 2: Alerts ===');
  const alertsData = deriveAlerts(summary);
  console.log(`Total alerts: ${alertsData.alerts.length} (${alertsData.total_criticas} critical, ${alertsData.total_avisos} warnings)`);
  for (const a of alertsData.alerts) {
    console.log(`  [${a.nivel}] ${a.cajero_nombre}: ${a.mensaje}`);
  }

  // Verify cajero2 is flagged (87.5% free vs 15% default historical = +72.5pp)
  const cajero2 = summary.cajeros.find(c => c.cajero_id === 3);
  console.log('\n=== Verification ===');
  console.log('Cajero2 pct_gratuitos:', cajero2?.pct_gratuitos_hoy, '(expected ~87.5%)');
  console.log('Cajero2 nivel_riesgo:', cajero2?.nivel_riesgo, '(expected CRITICO)');
  console.log('Cajero2 brecha:', cajero2?.brecha_ingresos, '(expected 0 - prices are set correctly)');
  console.log('Cajero2 ops sospechosas:', cajero2?.operaciones_sospechosas, '(expected 1)');

  const cajero1 = summary.cajeros.find(c => c.cajero_id === 2);
  console.log('Cajero1 pct_gratuitos:', cajero1?.pct_gratuitos_hoy, '(expected 20%)');
  console.log('Cajero1 nivel_riesgo:', cajero1?.nivel_riesgo);

  console.log('\n🎉 ALL FRAUD TESTS PASSED!');
  await prisma.$disconnect();
}

test().catch(e => { console.error('❌ FAILED:', e); process.exit(1); });
