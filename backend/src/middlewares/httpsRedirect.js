/**
 * HTTPS enforcement.
 *
 * In production the API is expected to sit behind a TLS-terminating reverse
 * proxy (nginx / Caddy / a load balancer), so the original scheme arrives in
 * `X-Forwarded-Proto`. Requires `app.set('trust proxy', ...)` for that header
 * to be honoured — otherwise Express ignores it and this middleware would be
 * trivially bypassable by spoofing the header.
 *
 * Disabled outside production, and skippable via FORCE_HTTPS=false for
 * deployments where TLS is enforced upstream and the proxy never forwards HTTP.
 */
const { logger } = require('../utils/logger');

const isProduction = process.env.NODE_ENV === 'production';
// Default: on in production, off elsewhere. FORCE_HTTPS overrides both ways.
const forceHttps = process.env.FORCE_HTTPS
  ? process.env.FORCE_HTTPS === 'true'
  : isProduction;

const enforceHttps = (req, res, next) => {
  if (!forceHttps || req.secure) return next();

  // Health checks come from the load balancer over plain HTTP — never redirect
  // them or the instance gets marked unhealthy.
  if (req.path === '/health') return next();

  logger.warn({
    event: 'security.https.redirect',
    ip: req.ip,
    path: req.originalUrl,
    method: req.method,
    requestId: req.requestId,
  });

  // A redirect only makes sense for safe, replayable methods. For anything
  // else the body would be silently dropped by most clients, so fail loudly:
  // the credentials/payload already travelled in the clear and must be treated
  // as compromised rather than transparently retried.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(403).json({
      message: 'HTTPS requerido. Reintentá la solicitud sobre HTTPS.',
      code: 'HTTPS_REQUIRED',
    });
  }

  return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
};

module.exports = { enforceHttps, forceHttps };
