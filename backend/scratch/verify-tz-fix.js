// Verify the timezone fix works
const { calculateCashierFraudMetrics } = require('../src/services/fraud.service');

(async () => {
  // Test with explicit date string (what the frontend sends)
  const result = await calculateCashierFraudMetrics('2026-04-22');
  console.log('Date returned:', result.date);
  console.log('Cajeros found:', result.cajeros.length);
  result.cajeros.forEach(c => {
    console.log(`  ${c.cajero_nombre}: ${c.total_persons} persons, ${c.pct_gratuitos_hoy}% free, risk=${c.nivel_riesgo}`);
  });
  console.log('Totales:', JSON.stringify(result.totales));
  
  if (result.date === '2026-04-22' && result.cajeros.length > 0) {
    console.log('\n✅ TIMEZONE FIX VERIFIED — correct date and data found');
  } else {
    console.log('\n❌ STILL BROKEN — date:', result.date, 'cajeros:', result.cajeros.length);
  }
  
  const prisma = require('../src/utils/prisma');
  await prisma.$disconnect();
})();
