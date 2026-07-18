const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const ticketController = require('../controllers/ticket.controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const { validate, validateQuery } = require('../middlewares/validate');
const { createTicketSchema, validateTicketSchema, cancelTicketSchema, listTicketsQuerySchema } = require('../validators/ticket.validator');
const { logger } = require('../utils/logger');

// ─── Rate limiters ──────────────────────────────────────────
const createTicketLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ event: 'ratelimit.exceeded', ip: req.ip, path: '/tickets', requestId: req.requestId });
    res.status(429).json({ error: 'Demasiadas solicitudes. Intentá de nuevo en un momento.' });
  },
});

const validateTicketLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ event: 'ratelimit.exceeded', ip: req.ip, path: '/tickets/validate', requestId: req.requestId });
    res.status(429).json({ error: 'Demasiadas validaciones. Intentá de nuevo en un momento.' });
  },
});

// ─── Routes ─────────────────────────────────────────────────
// List all tickets (Admin & Cashier — IDOR filtering applied in controller)
router.get('/', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), validateQuery(listTicketsQuerySchema), ticketController.listTickets);

// Create a new ticket (Admin & Cashier)
router.post('/', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), createTicketLimiter, validate(createTicketSchema), ticketController.createTicket);

// Validate a ticket (Guard only)
router.post('/validate', authenticateToken, authorizeRoles('GUARD'), validateTicketLimiter, validate(validateTicketSchema), ticketController.validateTicket);

// Pricing (Admin & Cashier — used by frontend to avoid hardcoding prices)
router.get('/pricing', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), ticketController.getPricing);

// Get group by operation code (Admin & Cashier)
router.get('/group/:operationCode', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), ticketController.getGroupByCode);

// Get specific ticket details (Admin & Cashier)
router.get('/:id', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), ticketController.getTicket);

// Cancel a ticket (Admin only) — motivo obligatorio, queda en la trazabilidad
router.patch('/:id/cancel', authenticateToken, authorizeRoles('ADMIN'), validate(cancelTicketSchema), ticketController.cancelTicket);

// Regenerate a ticket's QR/token (Admin only) — invalidates the previous one
router.post('/:id/regenerate-qr', authenticateToken, authorizeRoles('ADMIN'), ticketController.regenerateQr);

// Print a ticket on the configured network thermal printer (Admin & Cashier)
router.post('/:id/print-thermal', authenticateToken, authorizeRoles('ADMIN', 'CASHIER'), ticketController.printThermal);

module.exports = router;
