const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'dev.db');
const adapter = new PrismaBetterSqlite3({ url: 'file:' + dbPath });
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminEmail = 'admin@tourist.com';
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existing) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        role: 'ADMIN'
      }
    });
    console.log('Admin user created: admin@tourist.com / admin123');
  } else {
    console.log('Admin user already exists.');
  }

  const cashierEmail = 'cajero@tourist.com';
  const existingCashier = await prisma.user.findUnique({ where: { email: cashierEmail } });
  if (!existingCashier) {
    const hashedPassword = await bcrypt.hash('cajero123', 10);
    await prisma.user.create({
      data: {
        email: cashierEmail,
        password: hashedPassword,
        role: 'CASHIER'
      }
    });
    console.log('Cashier user created: cajero@tourist.com / cajero123');
  }

  const guardEmail = 'guardia@tourist.com';
  const existingGuard = await prisma.user.findUnique({ where: { email: guardEmail } });
  if (!existingGuard) {
    const hashedPassword = await bcrypt.hash('guardia123', 10);
    await prisma.user.create({
      data: {
        email: guardEmail,
        password: hashedPassword,
        role: 'GUARD'
      }
    });
    console.log('Guard user created: guardia@tourist.com / guardia123');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
