/**
 * Environment variable validation — fail fast if critical config is missing.
 * Called BEFORE any other initialization in index.js.
 */

const REQUIRED = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'DATABASE_URL',
  'ADULT_PRICE',
  'ALLOWED_ORIGINS',
];

function validateEnv() {
  const missing = REQUIRED.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`[FATAL] Variables de entorno requeridas no definidas: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (process.env.JWT_SECRET.length < 32) {
    console.error('[FATAL] JWT_SECRET debe tener al menos 32 caracteres');
    process.exit(1);
  }

  if (process.env.JWT_REFRESH_SECRET.length < 32) {
    console.error('[FATAL] JWT_REFRESH_SECRET debe tener al menos 32 caracteres');
    process.exit(1);
  }

  if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    console.error('[FATAL] JWT_SECRET y JWT_REFRESH_SECRET deben ser distintos');
    process.exit(1);
  }
}

module.exports = { validateEnv };
