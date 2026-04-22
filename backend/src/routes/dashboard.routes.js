const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const fraudController = require('../controllers/fraud.controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');

// ── Existing dashboard routes (DO NOT MODIFY) ────────────────
// Get basic stats (Admin & Cashier)
router.get('/stats', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), dashboardController.getStats);

// Get users list (Admin only)
router.get('/users', authenticateToken, authorizeRoles('ADMIN'), dashboardController.getUsers);

// ── NEW: Anti-fraud panel routes (ADMIN only) ────────────────
router.get('/fraud-summary',          authenticateToken, authorizeRoles('ADMIN'), fraudController.getFraudSummary);
router.get('/alerts',                 authenticateToken, authorizeRoles('ADMIN'), fraudController.getAlerts);
router.get('/gratuitos-evolution',    authenticateToken, authorizeRoles('ADMIN'), fraudController.getGratuitosEvolution);
router.get('/suspicious-operations',  authenticateToken, authorizeRoles('ADMIN'), fraudController.getSuspiciousOperations);
router.get('/cashier-history',        authenticateToken, authorizeRoles('ADMIN'), fraudController.getCashierHistory);

module.exports = router;
