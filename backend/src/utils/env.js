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

  validateProductionSecurity();
}

/**
 * Production-only guards. These are warnings-turned-fatal: shipping without
 * HTTPS or with a wide-open CORS origin is the kind of thing that only gets
 * noticed after an incident.
 */
function validateProductionSecurity() {
  if (process.env.NODE_ENV !== 'production') return;

  const errors = [];

  if (process.env.FORCE_HTTPS === 'false') {
    errors.push('FORCE_HTTPS=false en producción: el tráfico viajaría en texto plano');
  }

  const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);

  if (origins.includes('*')) {
    errors.push('ALLOWED_ORIGINS no puede ser "*" en producción');
  }

  const insecureOrigins = origins.filter(o => o.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(o));
  if (insecureOrigins.length > 0) {
    errors.push(`ALLOWED_ORIGINS contiene orígenes HTTP no seguros: ${insecureOrigins.join(', ')}`);
  }

  if (errors.length > 0) {
    console.error('[FATAL] Configuración insegura para producción:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}

module.exports = { validateEnv };
