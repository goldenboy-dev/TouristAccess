const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const dashboardController = require('../controllers/dashboard.controller');
const fraudController = require('../controllers/fraud.controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const { validate, validateQuery } = require('../middlewares/validate');
const {
  updateUserNameSchema,
  updateUserRoleSchema,
  updateUserActiveSchema,
  updatePricingSchema,
  updateOperatingSettingsSchema,
  cashReportQuerySchema,
  cashReportExportQuerySchema,
  statsQuerySchema,
  executiveSummaryQuerySchema,
  auditLogQuerySchema,
  fraudSummaryQuerySchema,
  alertsQuerySchema,
  alertsHistoryQuerySchema,
  updateAlertStatusSchema,
  evolutionQuerySchema,
  suspiciousOperationsQuerySchema,
  cashierHistoryQuerySchema,
} = require('../validators/dashboard.validator');
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
router.get('/stats', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), dashboardLimiter, validateQuery(statsQuerySchema), dashboardController.getStats);
router.get('/executive-summary', authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, validateQuery(executiveSummaryQuerySchema), dashboardController.getExecutiveSummary);
router.get('/users', authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, dashboardController.getUsers);
router.patch('/users/:id/name', authenticateToken, authorizeRoles('ADMIN'), validate(updateUserNameSchema), dashboardController.updateUserName);
router.patch('/users/:id/role', authenticateToken, authorizeRoles('ADMIN'), validate(updateUserRoleSchema), dashboardController.updateUserRole);
router.patch('/users/:id/active', authenticateToken, authorizeRoles('ADMIN'), validate(updateUserActiveSchema), dashboardController.updateUserActive);
router.patch('/pricing', authenticateToken, authorizeRoles('ADMIN'), validate(updatePricingSchema), dashboardController.updatePricing);
router.get('/settings', authenticateToken, authorizeRoles('ADMIN'), dashboardController.getOperatingSettings);
router.patch('/settings', authenticateToken, authorizeRoles('ADMIN'), validate(updateOperatingSettingsSchema), dashboardController.updateOperatingSettings);
router.get('/audit-log', authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, validateQuery(auditLogQuerySchema), dashboardController.getAuditLog);
router.get('/cash-report', authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, validateQuery(cashReportQuerySchema), dashboardController.getCashReport);
router.get('/cash-report/export', authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, validateQuery(cashReportExportQuerySchema), dashboardController.exportCashReport);

// ── Anti-fraud panel routes (ADMIN only) ────────────────
router.get('/fraud-summary',          authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, validateQuery(fraudSummaryQuerySchema), fraudController.getFraudSummary);
router.get('/alerts',                 authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, validateQuery(alertsQuerySchema), fraudController.getAlerts);
router.get('/alerts-history',         authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, validateQuery(alertsHistoryQuerySchema), fraudController.getAlertsHistory);
router.patch('/alerts-history/:id/status', authenticateToken, authorizeRoles('ADMIN'), validate(updateAlertStatusSchema), fraudController.updateAlertStatus);
router.get('/gratuitos-evolution',    authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, validateQuery(evolutionQuerySchema), fraudController.getGratuitosEvolution);
router.get('/suspicious-operations',  authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, validateQuery(suspiciousOperationsQuerySchema), fraudController.getSuspiciousOperations);
router.get('/cashier-history',        authenticateToken, authorizeRoles('ADMIN'), dashboardLimiter, validateQuery(cashierHistoryQuerySchema), fraudController.getCashierHistory);

module.exports = router;
