/**
 * Simple in-memory rate limiter for validation endpoint.
 * Prevents brute-force token guessing.
 */
const rateLimitStore = new Map();

const rateLimit = ({ windowMs = 60000, maxRequests = 30 } = {}) => {
  return (req, res, next) => {
    const key = req.user?.id || req.ip;
    const now = Date.now();

    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    const entry = rateLimitStore.get(key);

    if (now > entry.resetAt) {
      entry.count = 1;
      entry.resetAt = now + windowMs;
      return next();
    }

    entry.count++;

    if (entry.count > maxRequests) {
      return res.status(429).json({ message: 'Demasiadas solicitudes. Intente de nuevo en un momento.' });
    }

    next();
  };
};

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  }
}, 300000);

module.exports = { rateLimit };
