const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const { rateLimit } = require('../middlewares/rateLimit');

// List all tickets (Admin & Cashier)
router.get('/', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), ticketController.listTickets);

// Create a new ticket (Admin & Cashier)
router.post('/', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), ticketController.createTicket);

// Validate a ticket (Guard only) — rate limited to prevent brute force
router.post('/validate', authenticateToken, authorizeRoles('GUARD'), rateLimit({ windowMs: 60000, maxRequests: 60 }), ticketController.validateTicket);

// Get group by operation code (Admin & Cashier)
router.get('/group/:operationCode', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), ticketController.getGroupByCode);

// Get specific ticket details (Admin & Cashier)
router.get('/:id', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), ticketController.getTicket);

// Cancel a ticket (Admin only)
router.patch('/:id/cancel', authenticateToken, authorizeRoles('ADMIN'), ticketController.cancelTicket);

module.exports = router;
