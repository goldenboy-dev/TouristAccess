const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');

// Get basic stats (Admin & Cashier)
router.get('/stats', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), dashboardController.getStats);

// Get users list (Admin only)
router.get('/users', authenticateToken, authorizeRoles('ADMIN'), dashboardController.getUsers);

module.exports = router;
