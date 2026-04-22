const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'dev.db');
const adapter = new PrismaBetterSqlite3({ url: 'file:' + dbPath });
const prisma = new PrismaClient({ adapter });

async function main() {
  const users = [
    { email: 'admin@tourist.com',   name: 'Carlos Administrador', password: 'admin123',   role: 'ADMIN' },
    { email: 'cajero@tourist.com',  name: 'María González',       password: 'cajero123',  role: 'CASHIER' },
    { email: 'cajero2@tourist.com', name: 'Ana Rodríguez',        password: 'cajero123',  role: 'CASHIER' },
    { email: 'guardia@tourist.com', name: 'Pedro Guardia',        password: 'guardia123', role: 'GUARD' },
  ];

  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (!existing) {
      const hashedPassword = await bcrypt.hash(u.password, 10);
      await prisma.user.create({
        data: { email: u.email, name: u.name, password: hashedPassword, role: u.role }
      });
      console.log(`User created: ${u.email} (${u.name}) / ${u.password}`);
    } else {
      // Update name if missing
      if (!existing.name) {
        await prisma.user.update({ where: { id: existing.id }, data: { name: u.name } });
        console.log(`Updated name for: ${u.email}`);
      } else {
        console.log(`User already exists: ${u.email}`);
      }
    }
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
