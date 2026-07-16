const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/auth.controller');
const { authenticateToken, authenticatePasswordChange, authorizeRoles } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { loginSchema, registerSchema, refreshSchema, changePasswordSchema } = require('../validators/auth.validator');
const { logger } = require('../utils/logger');

// ─── Rate limiters ──────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ event: 'ratelimit.exceeded', ip: req.ip, path: '/auth/login', requestId: req.requestId });
    res.status(429).json({ error: 'Demasiados intentos de login. Intentá de nuevo en 15 minutos.' });
  },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ event: 'ratelimit.exceeded', ip: req.ip, path: '/auth/refresh', requestId: req.requestId });
    res.status(429).json({ error: 'Demasiados intentos de refresh. Intentá de nuevo en 15 minutos.' });
  },
});

// Guessing the CURRENT password through this endpoint must be as expensive as
// guessing it through /login.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ event: 'ratelimit.exceeded', ip: req.ip, path: '/auth/change-password', requestId: req.requestId });
    res.status(429).json({ error: 'Demasiados intentos de cambio de contraseña. Intentá de nuevo en 15 minutos.' });
  },
});

// ─── Routes ─────────────────────────────────────────────────
router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/refresh', refreshLimiter, validate(refreshSchema), authController.refresh);
router.post('/logout', authenticateToken, authController.logoutHandler);

// Accepts a normal session token OR the restricted token issued at login when
// the password is expired / flagged for rotation.
router.post(
  '/change-password',
  changePasswordLimiter,
  authenticatePasswordChange,
  validate(changePasswordSchema),
  authController.changePassword
);

// Self-service panic button: kills every session of the caller's own account
// (lost or stolen device). No admin required.
router.post('/revoke-my-sessions', authenticateToken, authController.revokeMySessions);

// Only ADMIN can register new internal staff
router.post('/register', authenticateToken, authorizeRoles('ADMIN'), validate(registerSchema), authController.register);

// Admin can revoke all tokens for a specific user (force re-login).
// Body may include { forcePasswordChange: true } when the credential itself is
// suspected compromised.
router.post('/revoke/:userId', authenticateToken, authorizeRoles('ADMIN'), authController.revokeAllTokens);

// Get current user profile
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
