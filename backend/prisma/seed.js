require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const { generateCompliantPassword, getPasswordErrors } = require('../src/utils/password');

const dbPath = path.join(__dirname, 'dev.db');
const adapter = new PrismaBetterSqlite3({ url: 'file:' + dbPath });
const prisma = new PrismaClient({ adapter });

const isProduction = process.env.NODE_ENV === 'production';

// Passwords are NEVER hardcoded here. Each user's password comes from its env
// var; if absent, a compliant random one is generated and printed ONCE so the
// operator can hand it over. Either way the account is flagged
// must_change_password, so the seeded value only survives the first login.
const USERS = [
  { email: 'admin@tourist.com',   name: 'Carlos Administrador', role: 'ADMIN',   envVar: 'SEED_ADMIN_PASSWORD' },
  { email: 'cajero@tourist.com',  name: 'María González',       role: 'CASHIER', envVar: 'SEED_CASHIER1_PASSWORD' },
  { email: 'cajero2@tourist.com', name: 'Ana Rodríguez',        role: 'CASHIER', envVar: 'SEED_CASHIER2_PASSWORD' },
  { email: 'guardia@tourist.com', name: 'Pedro Guardia',        role: 'GUARD',   envVar: 'SEED_GUARD_PASSWORD' },
];

function resolvePassword(user) {
  const fromEnv = process.env[user.envVar];

  if (fromEnv) {
    const errors = getPasswordErrors(fromEnv);
    if (errors.length > 0) {
      console.error(`[FATAL] ${user.envVar} no cumple la política de contraseñas:`);
      errors.forEach((e) => console.error(`  - ${e}`));
      process.exit(1);
    }
    return { password: fromEnv, generated: false };
  }

  // In production, silently inventing credentials for a privileged account and
  // printing them to a log stream is not acceptable — make it an explicit step.
  if (isProduction) {
    console.error(`[FATAL] ${user.envVar} es obligatoria en producción (usuario ${user.email}).`);
    process.exit(1);
  }

  return { password: generateCompliantPassword(), generated: true };
}

async function main() {
  const generatedCredentials = [];

  for (const u of USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });

    if (!existing) {
      const { password, generated } = resolvePassword(u);
      const hashedPassword = await bcrypt.hash(password, 12);

      await prisma.user.create({
        data: {
          email: u.email,
          name: u.name,
          password: hashedPassword,
          role: u.role,
          password_changed_at: new Date(),
          must_change_password: true,
        },
      });

      if (generated) generatedCredentials.push({ email: u.email, password });
      console.log(`Usuario creado: ${u.email} (${u.name}) — contraseña ${generated ? 'generada' : 'desde ' + u.envVar}`);
    } else {
      const data = {};
      if (!existing.name) data.name = u.name;

      // Accounts seeded before the password policy still hold the demo
      // passwords that live in this repo's git history. SEED_FORCE_ROTATE=true
      // flags them so the next login must set a real one. Opt-in, because it
      // locks every existing dev session out of the UI until they rotate.
      if (process.env.SEED_FORCE_ROTATE === 'true' && !existing.must_change_password) {
        data.must_change_password = true;
      }

      if (Object.keys(data).length > 0) {
        await prisma.user.update({ where: { id: existing.id }, data });
        console.log(`Usuario actualizado: ${u.email} (${Object.keys(data).join(', ')})`);
      } else {
        console.log(`Usuario ya existe (sin cambios): ${u.email}`);
      }
    }
  }

  if (generatedCredentials.length > 0) {
    console.log('\n' + '='.repeat(64));
    console.log('CONTRASEÑAS GENERADAS — SE MUESTRAN UNA SOLA VEZ');
    console.log('Guardalas ahora. Deben cambiarse en el primer inicio de sesión.');
    console.log('='.repeat(64));
    for (const c of generatedCredentials) {
      console.log(`  ${c.email.padEnd(24)} ${c.password}`);
    }
    console.log('='.repeat(64) + '\n');
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
