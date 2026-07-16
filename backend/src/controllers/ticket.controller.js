/**
 * HTTP layer for tickets: reads the request, delegates to ticket.service,
 * writes the audit entry (which needs request context: ip, user-agent,
 * requestId) and shapes the response. No business rules live here.
 */
const ticketService = require('../services/ticket.service');
const { auditFromRequest, AUDIT_EVENTS } = require('../utils/audit');
const { parseLocalDate } = require('../utils/date');

const actorFrom = (req) => ({ id: req.user.id, role: req.user.role });

// ─── CREATE (single or group) ────────────────────────────────
const createTicket = async (req, res, next) => {
  try {
    const result = await ticketService.createTicketGroup({
      input: req.body,
      cashierId: req.user.id,
    });

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.TICKET_CREATED,
      resource_type: 'GroupSummary',
      resource_id: result.summary.id,
      metadata: {
        operationCode: result.operationCode,
        groupId: result.groupId,
        adults: result.counts.adults,
        children: result.counts.children,
        locals: result.counts.locals,
        totalPersons: result.qty,
        totalAmount: result.totalAmount,
        paymentMethod: req.body.payment_method,
        visitDate: parseLocalDate(req.body.visit_date).toISOString(),
        ticketIds: result.ticketIds,
      },
    });

    res.status(201).json({
      message: `${result.qty} ticket(s) creados exitosamente`,
      operation_code: result.operationCode,
      group_id: result.groupId,
      summary: result.summary,
      cashier_email: result.cashierEmail,
      total: result.totalAmount,
      tickets: result.tickets,
    });
  } catch (error) {
    next(error);
  }
};

// ─── VALIDATE ────────────────────────────────────────────────
const validateTicket = async (req, res, next) => {
  try {
    const { token, free_confirmed } = req.body; // validated by Zod

    const result = await ticketService.validateTicketByToken({
      token,
      freeConfirmed: free_confirmed,
      guardId: req.user.id,
    });

    if (result.outcome === 'rejected') {
      await auditFromRequest(req, {
        event: AUDIT_EVENTS.TICKET_VALIDATION_REJECTED,
        outcome: 'FAILURE',
        resource_type: 'Ticket',
        resource_id: result.ticket?.id ?? null,
        metadata: result.audit,
      });
      return res.json(result.response);
    }

    if (result.outcome === 'confirmation_required') {
      return res.json(result.response);
    }

    // Free entries are the fraud-sensitive path: the audit row is what lets an
    // admin later prove which guard waved a CHILD/LOCAL through, and when.
    await auditFromRequest(req, {
      event: AUDIT_EVENTS.TICKET_VALIDATED,
      resource_type: 'Ticket',
      resource_id: result.ticket.id,
      metadata: {
        visitorType: result.ticket.visitor_type,
        price: result.ticket.price,
        groupId: result.ticket.group_id,
        freeEntry: result.isFreeEntry,
        freeConfirmed: result.isFreeEntry ? true : undefined,
        cedula: result.ticket.cedula || undefined,
        scannedAt: result.scannedAt.toISOString(),
      },
    });

    res.status(200).json(result.response);
  } catch (error) {
    next(error);
  }
};

// ─── GET GROUP BY OPERATION CODE ─────────────────────────────
const getGroupByCode = async (req, res, next) => {
  try {
    const summary = await ticketService.getGroupByOperationCode({
      operationCode: req.params.operationCode,
      actor: actorFrom(req),
    });
    res.status(200).json({ summary });
  } catch (error) {
    next(error);
  }
};

// ─── GET ONE ─────────────────────────────────────────────────
const getTicket = async (req, res, next) => {
  try {
    const ticket = await ticketService.getTicketById({ id: req.params.id, actor: actorFrom(req) });
    res.status(200).json({ ticket });
  } catch (error) {
    next(error);
  }
};

// ─── LIST ────────────────────────────────────────────────────
const listTickets = async (req, res, next) => {
  try {
    const result = await ticketService.listTickets({ filters: req.query, actor: actorFrom(req) });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// ─── CANCEL ──────────────────────────────────────────────────
const cancelTicket = async (req, res, next) => {
  try {
    const { previous, updated } = await ticketService.cancelTicketById({ id: req.params.id });

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.TICKET_CANCELLED,
      resource_type: 'Ticket',
      resource_id: updated.id,
      metadata: {
        previousStatus: previous.status,
        newStatus: updated.status,
        customerName: previous.customer_name,
        visitorType: previous.visitor_type,
        price: previous.price,
        groupId: previous.group_id,
        issuedBy: previous.createdById,
        visitDate: previous.visit_date.toISOString(),
      },
    });

    res.status(200).json({ message: 'Ticket cancelado', ticket: updated });
  } catch (error) {
    next(error);
  }
};

// ─── PRICING (so the frontend never hardcodes prices) ────────
const getPricing = async (_req, res, next) => {
  try {
    res.status(200).json(ticketService.getPricing());
  } catch (error) {
    next(error);
  }
};

module.exports = { createTicket, validateTicket, getTicket, listTickets, cancelTicket, getGroupByCode, getPricing };
