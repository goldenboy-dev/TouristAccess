const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const dashboardController = require('../controllers/dashboard.controller');
const fraudController = require('../controllers/fraud.controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const { logger } = require('../utils/logger');

// ─── Rate limiter for dashboard ─────────────────────────────
const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ event: 'ratelimit.exceeded', ip: req.ip, path: req.path, requestId: req.requestId });
    res.status(429).json({ error: 'Demasiadas solicitudes al dashboard.' });
  },
});

// ── Existing dashboard routes ────────────────
router.get('/stats', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), dashboardLimiter, dashboardController.getStats);
router.get('/users', authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, dashboardController.getUsers);
router.patch('/users/:id/name', authenticateToken, authorizeRoles('ADMIN'), dashboardController.updateUserName);
router.get('/audit-log', authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, dashboardController.getAuditLog);

// ── Anti-fraud panel routes (ADMIN only) ────────────────
router.get('/fraud-summary',          authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, fraudController.getFraudSummary);
router.get('/alerts',                 authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, fraudController.getAlerts);
router.get('/gratuitos-evolution',    authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, fraudController.getGratuitosEvolution);
router.get('/suspicious-operations',  authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, fraudController.getSuspiciousOperations);
router.get('/cashier-history',        authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, fraudController.getCashierHistory);

module.exports = router;
