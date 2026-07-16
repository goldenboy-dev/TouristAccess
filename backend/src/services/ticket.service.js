/**
 * Ticket business logic. Knows nothing about Express: takes plain arguments,
 * returns plain data, throws AppError. The controller owns HTTP and auditing.
 */
const { randomUUID } = require('crypto');
const prisma = require('../utils/prisma');
const { generateSecureToken } = require('../utils/crypto');
const { logger } = require('../utils/logger');
const { badRequest, forbidden, notFound } = require('../utils/errors');
const {
  parseLocalDate, startOfLocalDay, endOfLocalDay, startOfToday, localDaysBetween, isSameLocalDay,
  toLocalDateStr,
} = require('../utils/date');
const { renderTicketQR, renderTicketHTML, persistTicketHTML } = require('./ticket-render.service');
const { PAYMENT_METHODS, MAX_PERSONS, MAX_VISIT_DATE_DRIFT_DAYS } = require('../constants/ticket');

// ─── Server-side pricing (NEVER trust frontend) ──────────────
const ADULT_PRICE = parseInt(process.env.ADULT_PRICE) || 10000;
const PRICING = { ADULT: ADULT_PRICE, CHILD: 0, LOCAL: 0 };

function getPricing() {
  return { ADULT_PRICE: PRICING.ADULT, CHILD_PRICE: PRICING.CHILD, LOCAL_PRICE: PRICING.LOCAL };
}

// ─── CREATE ──────────────────────────────────────────────────
// Zod already rejects malformed bodies at the edge; these checks are the last
// line of defence for any caller that reaches the service directly.
function assertCreateInvariants({ adults, children, locals, payment_method, customer_name, visit_date }) {
  const qty = adults + children + locals;
  if (qty <= 0) throw badRequest('El total de personas debe ser mayor a 0');
  if (qty > MAX_PERSONS) throw badRequest(`El total de personas no puede superar ${MAX_PERSONS}`);
  if (!PAYMENT_METHODS.includes(payment_method)) {
    throw badRequest('payment_method debe ser CASH, TRANSFER, QR o CARD');
  }
  if (customer_name && customer_name.length > 100) {
    throw badRequest('El nombre del cliente no puede superar 100 caracteres');
  }
  if (customer_name && /<[^>]*>/.test(customer_name)) {
    throw badRequest('El nombre del cliente no puede contener HTML');
  }

  const parsedVisitDate = parseLocalDate(visit_date);
  if (!parsedVisitDate) throw badRequest('visit_date tiene un formato inválido');

  const driftDays = Math.abs(localDaysBetween(startOfToday(), parsedVisitDate));
  if (driftDays > MAX_VISIT_DATE_DRIFT_DAYS) {
    throw badRequest(`visit_date no puede ser más de ${MAX_VISIT_DATE_DRIFT_DAYS} días en el pasado o futuro`);
  }
}

// Builds the per-person rows: names, prices and cédulas. Pure — the pricing
// decisions live here and nowhere else.
function buildTicketRows({ adults, children, locals, customer_name, childrenCedulas, localsCedulas }) {
  // Local date, not toISOString(): a ticket sold at 21:00 in Paraguay would
  // otherwise be printed with tomorrow's date in its code.
  const dateStr = toLocalDateStr(new Date()).replace(/-/g, '');
  const rows = [];
  let index = 1;

  const nameFor = () => (customer_name
    ? `${customer_name.trim()} #${index}`
    : `VIS-${dateStr}-${index.toString().padStart(2, '0')}`);

  for (let i = 0; i < adults; i++) {
    rows.push({ type: 'ADULT', name: nameFor(), price: PRICING.ADULT, cedula: null });
    index++;
  }
  for (let i = 0; i < children; i++) {
    const cedula = childrenCedulas[i] ? String(childrenCedulas[i]).trim() || null : null;
    rows.push({ type: 'CHILD', name: nameFor(), price: PRICING.CHILD, cedula });
    index++;
  }
  for (let i = 0; i < locals; i++) {
    rows.push({ type: 'LOCAL', name: nameFor(), price: PRICING.LOCAL, cedula: String(localsCedulas[i]).trim() });
    index++;
  }

  return rows;
}

async function createTicketGroup({ input, cashierId }) {
  const {
    customer_name,
    visit_date,
    payment_method,
    number_of_adults = 0,
    number_of_children = 0,
    number_of_locals = 0,
    children_cedulas = [],
    locals_cedulas = [],
  } = input;

  const adults   = parseInt(number_of_adults) || 0;
  const children = parseInt(number_of_children) || 0;
  const locals   = parseInt(number_of_locals) || 0;
  const qty      = adults + children + locals;

  assertCreateInvariants({ adults, children, locals, payment_method, customer_name, visit_date });

  // Cédula is what makes a free LOCAL entry auditable — without it the
  // anti-fraud panel cannot tell a real resident from an invented one.
  const localsCedulas = Array.isArray(locals_cedulas) ? locals_cedulas : [];
  if (locals > 0 && localsCedulas.length !== locals) {
    throw badRequest(`Se requieren ${locals} cédula(s) para residentes locales, se recibieron ${localsCedulas.length}`);
  }
  localsCedulas.forEach((cedula, i) => {
    if (!cedula || String(cedula).trim().length === 0) {
      throw badRequest(`La cédula del residente local #${i + 1} es obligatoria`);
    }
  });
  const childrenCedulas = Array.isArray(children_cedulas) ? children_cedulas : [];

  const cashier = await prisma.user.findUnique({
    where: { id: parseInt(cashierId) },
    select: { email: true },
  });
  if (!cashier) throw notFound('Cajero no encontrado');

  const groupId = randomUUID();
  const operationCode = groupId.split('-')[0]; // short code e.g. "30b520a4"
  const totalAmount = adults * PRICING.ADULT;
  const rows = buildTicketRows({ adults, children, locals, customer_name, childrenCedulas, localsCedulas });
  // Local midnight, not UTC midnight: the guard compares this against their own
  // "today", and west of Greenwich a UTC-parsed date is the previous day.
  const visitDate = parseLocalDate(visit_date);

  // Atomic: a group summary without its tickets (or vice versa) would corrupt
  // every fraud metric derived from them.
  const { groupSummary, tickets } = await prisma.$transaction(async (tx) => {
    const summary = await tx.groupSummary.create({
      data: {
        operation_code: operationCode,
        cajero_id: parseInt(cashierId),
        total_adults: adults,
        total_children: children,
        total_locals: locals,
        total_persons: qty,
        total_amount: totalAmount,
        payment_method,
        visit_date: visitDate,
      },
    });

    const created = [];
    for (const row of rows) {
      created.push(await tx.ticket.create({
        data: {
          token: generateSecureToken(),
          customer_name: row.name,
          visitor_type: row.type,
          price: row.price,
          cedula: row.cedula,
          group_id: groupId,
          group_summary_id: summary.id,
          visit_date: visitDate,
          payment_method,
          createdById: parseInt(cashierId),
        },
      }));
    }

    return { groupSummary: summary, tickets: created };
  });

  const responseTickets = [];
  for (const ticket of tickets) {
    const qr = await renderTicketQR(ticket.token);
    const html = renderTicketHTML(ticket, qr, cashier.email);
    const htmlFile = await persistTicketHTML(ticket, html);
    responseTickets.push(htmlFile ? { ticket, qr, htmlFile } : { ticket, qr });
  }

  return {
    operationCode,
    groupId,
    summary: groupSummary,
    cashierEmail: cashier.email,
    totalAmount,
    qty,
    tickets: responseTickets,
    ticketIds: tickets.map((t) => t.id),
    counts: { adults, children, locals },
  };
}

// ─── VALIDATE ────────────────────────────────────────────────
// Returns an outcome the controller turns into a response + audit entry.
// Every rejection carries `audit` because a guard racking up rejections is
// itself a signal, and gate disputes need a record of what was scanned.
async function validateTicketByToken({ token, freeConfirmed, guardId }) {
  const cleanToken = token.trim();
  const ticket = await prisma.ticket.findUnique({
    where: { token: cleanToken },
    include: { groupSummary: true },
  });

  if (!ticket) {
    return {
      outcome: 'rejected',
      ticket: null,
      // Log a token prefix only — the full token is a bearer credential.
      audit: { reason: 'token_not_found', tokenPrefix: cleanToken.slice(0, 8) },
      response: { status: 'invalid', message: 'Ticket no encontrado' },
    };
  }

  if (ticket.status === 'CANCELLED') {
    return {
      outcome: 'rejected',
      ticket,
      audit: { reason: 'ticket_cancelled' },
      response: { status: 'invalid', message: 'Este ticket fue cancelado' },
    };
  }

  // Exact day comparison — tickets are valid ONLY for their visit date.
  if (!isSameLocalDay(ticket.visit_date, new Date())) {
    const visitDay = startOfLocalDay(ticket.visit_date);
    return {
      outcome: 'rejected',
      ticket,
      audit: { reason: 'wrong_date', visitDate: visitDay.toISOString() },
      response: {
        status: 'invalid',
        message: `Ticket no válido para hoy (fecha: ${visitDay.toLocaleDateString('es-ES')})`,
      },
    };
  }

  if (ticket.status === 'USED') {
    const lastScan = await prisma.scan.findFirst({
      where: { ticketId: ticket.id },
      orderBy: { scannedAt: 'desc' },
    });
    return {
      outcome: 'rejected',
      ticket,
      audit: { reason: 'already_used', firstUsedAt: lastScan?.scannedAt?.toISOString() },
      response: {
        status: 'already_used',
        message: 'Este ticket ya fue utilizado',
        ticket: {
          customer_name: ticket.customer_name,
          visitor_type: ticket.visitor_type,
          usedAt: lastScan?.scannedAt || ticket.updatedAt,
        },
      },
    };
  }

  const isFreeEntry = ticket.visitor_type === 'CHILD' || ticket.visitor_type === 'LOCAL';
  if (isFreeEntry && freeConfirmed !== true) {
    const typeLabel = ticket.visitor_type === 'CHILD' ? 'menor de 12 años' : 'residente local';
    return {
      outcome: 'confirmation_required',
      ticket,
      response: {
        status: 'confirmation_required',
        error: 'CONFIRMATION_REQUIRED',
        message: `Confirmá que esta persona es ${typeLabel}`,
        ticket: {
          id: ticket.id,
          customer_name: ticket.customer_name,
          visitor_type: ticket.visitor_type,
          cedula: ticket.cedula,
          price: ticket.price,
          group_id: ticket.group_id,
        },
      },
    };
  }

  // Atomic ACTIVE→USED + scan: prevents double entry when two guards scan the
  // same QR at once — both can pass the checks above before either writes.
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id: ticket.id, status: 'ACTIVE' },
        data: {
          status: 'USED',
          guard_id: parseInt(guardId),
          free_confirmed: isFreeEntry ? 'CONFIRMED' : null,
          free_confirmed_at: isFreeEntry ? now : null,
        },
      });

      if (updated.count === 0) throw new Error('ALREADY_USED_RACE');

      await tx.scan.create({ data: { ticketId: ticket.id, guardId: parseInt(guardId) } });
    });
  } catch (txError) {
    if (txError.message === 'ALREADY_USED_RACE') {
      return {
        outcome: 'rejected',
        ticket,
        audit: { reason: 'already_used_race' },
        response: { status: 'already_used', message: 'Este ticket acaba de ser validado por otro guardia' },
      };
    }
    throw txError;
  }

  const response = {
    status: 'valid',
    message: 'Acceso permitido',
    ticket: {
      id: ticket.id,
      customer_name: ticket.customer_name,
      visitor_type: ticket.visitor_type,
      price: ticket.price,
      cedula: ticket.cedula,
      group_id: ticket.group_id,
    },
  };

  if (ticket.groupSummary) {
    response.groupSummary = {
      total_adults: ticket.groupSummary.total_adults,
      total_children: ticket.groupSummary.total_children,
      total_locals: ticket.groupSummary.total_locals,
      total_amount: ticket.groupSummary.total_amount,
    };
  }

  return {
    outcome: 'valid',
    ticket,
    isFreeEntry,
    scannedAt: now,
    response,
  };
}

// ─── READ ────────────────────────────────────────────────────
async function getGroupByOperationCode({ operationCode, actor }) {
  const summary = await prisma.groupSummary.findUnique({
    where: { operation_code: operationCode },
    include: {
      cajero: { select: { id: true, email: true } },
      tickets: {
        include: { createdBy: { select: { id: true, email: true } } },
        orderBy: { id: 'asc' },
      },
    },
  });

  if (!summary) throw notFound('Grupo no encontrado');

  if (actor.role === 'CASHIER' && summary.cajero_id !== actor.id) {
    logger.warn({ event: 'auth.access_denied.idor', userId: actor.id, resource: 'GroupSummary', resourceId: operationCode });
    throw forbidden('No tienes permiso para ver este grupo');
  }

  return summary;
}

async function getTicketById({ id, actor }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: parseInt(id) },
    include: {
      scans: { include: { guard: { select: { id: true, email: true } } } },
      createdBy: { select: { id: true, email: true } },
      groupSummary: true,
    },
  });

  if (!ticket) throw notFound('Ticket no encontrado');

  if (actor.role === 'CASHIER' && ticket.createdById !== actor.id) {
    logger.warn({ event: 'auth.access_denied.idor', userId: actor.id, resource: 'Ticket', resourceId: id });
    throw forbidden('No tienes permiso para ver este ticket');
  }

  return ticket;
}

async function listTickets({ filters, actor }) {
  const { status, date, date_from, date_to, visitor_type, payment_method, page = 1, limit = 50 } = filters;
  const where = {};

  if (status) where.status = status;
  if (visitor_type) where.visitor_type = visitor_type;
  if (payment_method) where.payment_method = payment_method;

  // A cashier only ever sees their own sales.
  if (actor.role === 'CASHIER') where.createdById = actor.id;

  if (date) {
    where.visit_date = { gte: startOfLocalDay(date), lte: endOfLocalDay(date) };
  } else if (date_from || date_to) {
    where.visit_date = {};
    if (date_from) where.visit_date.gte = startOfLocalDay(date_from);
    if (date_to)   where.visit_date.lte = endOfLocalDay(date_to);
  }

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: { createdBy: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ticket.count({ where }),
  ]);

  return { tickets, total, page, limit };
}

// ─── CANCEL ──────────────────────────────────────────────────
async function cancelTicketById({ id }) {
  const ticketId = parseInt(id);
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });

  if (!ticket) throw notFound('Ticket no encontrado');
  if (ticket.status === 'CANCELLED') throw badRequest('El ticket ya fue cancelado');
  if (ticket.status === 'USED') throw badRequest('No se puede cancelar un ticket ya utilizado');

  // Guarded update: only ACTIVE→CANCELLED, so a scan landing between the read
  // above and this write cannot be undone by the cancellation.
  const result = await prisma.ticket.updateMany({
    where: { id: ticketId, status: 'ACTIVE' },
    data: { status: 'CANCELLED' },
  });

  if (result.count === 0) throw badRequest('El ticket cambió de estado, recargá e intentá de nuevo');

  const updated = await prisma.ticket.findUnique({ where: { id: ticketId } });
  return { previous: ticket, updated };
}

module.exports = {
  createTicketGroup,
  validateTicketByToken,
  getGroupByOperationCode,
  getTicketById,
  listTickets,
  cancelTicketById,
  getPricing,
  buildTicketRows,
  assertCreateInvariants,
  PRICING,
};
