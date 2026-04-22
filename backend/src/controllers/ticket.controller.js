const prisma = require('../utils/prisma');
const { generateSecureToken } = require('../utils/crypto');
const { randomUUID } = require('crypto');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// ─── Server-side pricing (NEVER trust frontend) ──────────────
const ADULT_PRICE = parseInt(process.env.ADULT_PRICE) || 10000;
const PRICING = { ADULT: ADULT_PRICE, CHILD: 0, LOCAL: 0 };
const VALID_PAYMENT = ['CASH', 'TRANSFER', 'QR', 'CARD'];
const VALID_VISITOR_TYPES = ['ADULT', 'CHILD', 'LOCAL'];
const TICKETS_DEMO_DIR = path.join(__dirname, '..', '..', 'tickets_demo');

// ─── Printable ticket HTML generator ─────────────────────────
function getVisitorLabel(type) {
  return { ADULT: 'Adulto', CHILD: 'Niño', LOCAL: 'Residente Local' }[type] || type;
}

function getVisitorColor(type) {
  return { ADULT: '#1d4ed8', CHILD: '#065f46', LOCAL: '#7c3aed' }[type] || '#6b7280';
}

function getVisitorBadgeBg(type) {
  return { ADULT: '#dbeafe', CHILD: '#d1fae5', LOCAL: '#ede9fe' }[type] || '#f3f4f6';
}

async function generateTicketHTML(ticket, qrDataUrl, cashierEmail) {
  const typeLabel = getVisitorLabel(ticket.visitor_type);
  const visitDate = new Date(ticket.visit_date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const createdAt = new Date(ticket.createdAt).toLocaleString('es-ES');
  const badgeColor = getVisitorColor(ticket.visitor_type);
  const badgeBg = getVisitorBadgeBg(ticket.visitor_type);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ticket #${ticket.id} - Tourist Access</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; background:#f5f5f5; display:flex; justify-content:center; padding:2rem; }
  .ticket { background:white; width:400px; border-radius:16px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.15); }
  .ticket-header { background:linear-gradient(135deg,#6366f1,#a855f7); color:white; padding:1.5rem; text-align:center; }
  .ticket-header h1 { font-size:1.5rem; font-weight:800; letter-spacing:0.05em; }
  .ticket-header p { opacity:0.85; font-size:0.875rem; margin-top:0.25rem; }
  .ticket-body { padding:1.5rem; }
  .ticket-field { display:flex; justify-content:space-between; padding:0.6rem 0; border-bottom:1px dashed #e5e7eb; }
  .ticket-field:last-child { border-bottom:none; }
  .ticket-field .field-label { color:#6b7280; font-size:0.8rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:600; }
  .ticket-field .field-value { font-weight:700; font-size:0.9rem; color:#1f2937; }
  .qr-section { text-align:center; padding:1.5rem; background:#f9fafb; border-top:2px dashed #e5e7eb; }
  .qr-section img { width:180px; height:180px; }
  .qr-section p { margin-top:0.75rem; font-size:0.75rem; color:#6b7280; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; }
  .qr-section .token { font-size:0.6rem; color:#9ca3af; word-break:break-all; margin-top:0.5rem; font-family:monospace; }
  .ticket-footer { text-align:center; padding:1rem; background:#f3f4f6; font-size:0.75rem; color:#9ca3af; }
  .badge { display:inline-block; padding:0.2rem 0.6rem; border-radius:20px; font-size:0.75rem; font-weight:700; }
</style>
</head>
<body>
<div class="ticket">
  <div class="ticket-header">
    <h1>🎫 Tourist Access</h1>
    <p>Cerro Yaguarón — Ticket de Acceso</p>
  </div>
  <div class="ticket-body">
    <div class="ticket-field">
      <span class="field-label">Cliente</span>
      <span class="field-value">${ticket.customer_name}</span>
    </div>
    <div class="ticket-field">
      <span class="field-label">Tipo</span>
      <span class="field-value"><span class="badge" style="background:${badgeBg};color:${badgeColor}">${typeLabel}</span></span>
    </div>
    <div class="ticket-field">
      <span class="field-label">Precio</span>
      <span class="field-value">${ticket.price > 0 ? '₲' + ticket.price.toLocaleString('es-PY') : 'GRATIS'}</span>
    </div>${ticket.cedula ? `
    <div class="ticket-field">
      <span class="field-label">Cédula</span>
      <span class="field-value">${ticket.cedula}</span>
    </div>` : ''}
    <div class="ticket-field">
      <span class="field-label">Fecha de Visita</span>
      <span class="field-value">${visitDate}</span>
    </div>
    <div class="ticket-field">
      <span class="field-label">Método de Pago</span>
      <span class="field-value">${ticket.payment_method}</span>
    </div>
    <div class="ticket-field">
      <span class="field-label">Cajero</span>
      <span class="field-value">${cashierEmail}</span>
    </div>
    <div class="ticket-field">
      <span class="field-label">Emisión</span>
      <span class="field-value">${createdAt}</span>
    </div>
    <div class="ticket-field">
      <span class="field-label">Estado</span>
      <span class="field-value"><span class="badge" style="background:#d1fae5;color:#065f46">ACTIVO</span></span>
    </div>
  </div>
  <div class="qr-section">
    <img src="${qrDataUrl}" alt="QR Code">
    <p>Escanear al ingresar</p>
    <div class="token">Token: ${ticket.token}</div>
  </div>
  <div class="ticket-footer">
    Ticket #${ticket.id} — Válido únicamente para la fecha indicada
  </div>
</div>
</body>
</html>`;

  const filename = `ticket_${ticket.id}.html`;
  const filepath = path.join(TICKETS_DEMO_DIR, filename);
  if (!fs.existsSync(TICKETS_DEMO_DIR)) fs.mkdirSync(TICKETS_DEMO_DIR, { recursive: true });
  fs.writeFileSync(filepath, html, 'utf8');
  return filename;
}

// ─── CREATE (single or group) ────────────────────────────────
const createTicket = async (req, res) => {
  try {
    if (!req.body) return res.status(400).json({ message: 'Request body is required' });

    const {
      customer_name,
      visit_date,
      payment_method,
      number_of_adults = 0,
      number_of_children = 0,
      number_of_locals = 0,
      children_cedulas = [],
      locals_cedulas = []
    } = req.body;

    const adults   = parseInt(number_of_adults) || 0;
    const children = parseInt(number_of_children) || 0;
    const locals   = parseInt(number_of_locals) || 0;
    const qty      = adults + children + locals;

    // ── Validations ──
    if (!visit_date || !payment_method) {
      return res.status(400).json({ message: 'Campos requeridos: visit_date, payment_method' });
    }
    if (qty <= 0) {
      return res.status(400).json({ message: 'El total de personas debe ser mayor a 0' });
    }
    if (qty > 50) {
      return res.status(400).json({ message: 'El total de personas no puede superar 50' });
    }
    if (!VALID_PAYMENT.includes(payment_method)) {
      return res.status(400).json({ message: 'payment_method debe ser CASH, TRANSFER, QR o CARD' });
    }

    // Validate cedulas for locals (OBLIGATORIO)
    const localsCedulaArr = Array.isArray(locals_cedulas) ? locals_cedulas : [];
    if (locals > 0 && localsCedulaArr.length !== locals) {
      return res.status(400).json({
        message: `Se requieren ${locals} cédula(s) para residentes locales, se recibieron ${localsCedulaArr.length}`
      });
    }
    for (let i = 0; i < localsCedulaArr.length; i++) {
      if (!localsCedulaArr[i] || String(localsCedulaArr[i]).trim().length === 0) {
        return res.status(400).json({ message: `La cédula del residente local #${i + 1} es obligatoria` });
      }
    }

    // Children cedulas are optional
    const childrenCedulaArr = Array.isArray(children_cedulas) ? children_cedulas : [];

    // ── Fetch cashier ──
    const cashier = await prisma.user.findUnique({
      where: { id: parseInt(req.user.id) },
      select: { email: true }
    });

    const groupId = randomUUID();
    const operationCode = groupId.split('-')[0]; // short code e.g. "30b520a4"
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const totalAmount = adults * PRICING.ADULT;

    // ── Prepare tickets data ──
    const ticketsToCreate = [];
    let ticketIndex = 1;

    for (let i = 0; i < adults; i++) {
      const name = customer_name
        ? `${customer_name.trim()} #${ticketIndex}`
        : `VIS-${dateStr}-${ticketIndex.toString().padStart(2, '0')}`;
      ticketsToCreate.push({ type: 'ADULT', name, price: PRICING.ADULT, cedula: null });
      ticketIndex++;
    }
    for (let i = 0; i < children; i++) {
      const name = customer_name
        ? `${customer_name.trim()} #${ticketIndex}`
        : `VIS-${dateStr}-${ticketIndex.toString().padStart(2, '0')}`;
      const cedula = childrenCedulaArr[i] ? String(childrenCedulaArr[i]).trim() || null : null;
      ticketsToCreate.push({ type: 'CHILD', name, price: PRICING.CHILD, cedula });
      ticketIndex++;
    }
    for (let i = 0; i < locals; i++) {
      const name = customer_name
        ? `${customer_name.trim()} #${ticketIndex}`
        : `VIS-${dateStr}-${ticketIndex.toString().padStart(2, '0')}`;
      ticketsToCreate.push({
        type: 'LOCAL',
        name,
        price: PRICING.LOCAL,
        cedula: String(localsCedulaArr[i]).trim()
      });
      ticketIndex++;
    }

    // ── Atomic transaction: GroupSummary + Tickets ──
    const createdData = [];
    let groupSummary;

    await prisma.$transaction(async (tx) => {
      // Create GroupSummary first
      groupSummary = await tx.groupSummary.create({
        data: {
          operation_code: operationCode,
          cajero_id: parseInt(req.user.id),
          total_adults: adults,
          total_children: children,
          total_locals: locals,
          total_persons: qty,
          total_amount: totalAmount,
          payment_method,
          visit_date: new Date(visit_date)
        }
      });

      // Create individual tickets
      for (const t of ticketsToCreate) {
        const token = generateSecureToken();
        const ticket = await tx.ticket.create({
          data: {
            token,
            customer_name: t.name,
            visitor_type: t.type,
            price: t.price,
            cedula: t.cedula,
            group_id: groupId,
            group_summary_id: groupSummary.id,
            visit_date: new Date(visit_date),
            payment_method,
            createdById: parseInt(req.user.id)
          }
        });
        createdData.push(ticket);
      }
    });

    // ── Generate QR codes ──
    const responseTickets = [];

    for (const ticket of createdData) {
      const qrDataUrl = await QRCode.toDataURL(ticket.token, {
        width: 300, margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });
      const htmlFile = await generateTicketHTML(ticket, qrDataUrl, cashier.email);
      responseTickets.push({ ticket, qr: qrDataUrl, htmlFile });
    }

    res.status(201).json({
      message: `${qty} ticket(s) creados exitosamente`,
      operation_code: operationCode,
      group_id: groupId,
      summary: groupSummary,
      cashier_email: cashier.email,
      total: totalAmount,
      tickets: responseTickets
    });
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── VALIDATE ────────────────────────────────────────────────
const validateTicket = async (req, res) => {
  try {
    if (!req.body) return res.status(400).json({ message: 'Request body is required' });
    const { token, free_confirmed } = req.body;

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return res.status(400).json({ message: 'Token is required' });
    }

    const cleanToken = token.trim();
    const ticket = await prisma.ticket.findUnique({
      where: { token: cleanToken },
      include: {
        groupSummary: true
      }
    });

    if (!ticket) return res.json({ status: 'invalid', message: 'Ticket no encontrado' });
    if (ticket.status === 'CANCELLED') return res.json({ status: 'invalid', message: 'Este ticket fue cancelado' });

    // Date validation
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const visitDate = new Date(ticket.visit_date); visitDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil(Math.abs(today - visitDate) / 86400000);

    if (diffDays > 1) {
      return res.json({
        status: 'invalid',
        message: `Ticket no válido para hoy (fecha: ${visitDate.toLocaleDateString('es-ES')})`
      });
    }

    if (ticket.status === 'USED') {
      const lastScan = await prisma.scan.findFirst({
        where: { ticketId: ticket.id },
        orderBy: { scannedAt: 'desc' }
      });
      return res.json({
        status: 'already_used',
        message: 'Este ticket ya fue utilizado',
        ticket: {
          customer_name: ticket.customer_name,
          visitor_type: ticket.visitor_type,
          usedAt: lastScan?.scannedAt || ticket.updatedAt
        }
      });
    }

    // ── Free entry confirmation for CHILD / LOCAL ──
    const isFreeEntry = ticket.visitor_type === 'CHILD' || ticket.visitor_type === 'LOCAL';
    if (isFreeEntry && free_confirmed !== true) {
      const typeLabel = ticket.visitor_type === 'CHILD'
        ? 'menor de 12 años'
        : 'residente local';
      return res.json({
        status: 'confirmation_required',
        error: 'CONFIRMATION_REQUIRED',
        message: `Confirmá que esta persona es ${typeLabel}`,
        ticket: {
          id: ticket.id,
          customer_name: ticket.customer_name,
          visitor_type: ticket.visitor_type,
          cedula: ticket.cedula,
          price: ticket.price,
          group_id: ticket.group_id
        }
      });
    }

    // ── Mark as USED (optimistic concurrency) ──
    const now = new Date();
    const updated = await prisma.ticket.updateMany({
      where: { id: ticket.id, status: 'ACTIVE' },
      data: {
        status: 'USED',
        guard_id: parseInt(req.user.id),
        free_confirmed: isFreeEntry ? 'CONFIRMED' : null,
        free_confirmed_at: isFreeEntry ? now : null
      }
    });

    if (updated.count === 0) {
      return res.json({
        status: 'already_used',
        message: 'Este ticket acaba de ser validado por otro guardia'
      });
    }

    // Create scan record
    await prisma.scan.create({
      data: { ticketId: ticket.id, guardId: parseInt(req.user.id) }
    });

    // Build response with group summary if available
    const response = {
      status: 'valid',
      message: 'Acceso permitido',
      ticket: {
        id: ticket.id,
        customer_name: ticket.customer_name,
        visitor_type: ticket.visitor_type,
        price: ticket.price,
        cedula: ticket.cedula,
        group_id: ticket.group_id
      }
    };

    if (ticket.groupSummary) {
      response.groupSummary = {
        total_adults: ticket.groupSummary.total_adults,
        total_children: ticket.groupSummary.total_children,
        total_locals: ticket.groupSummary.total_locals,
        total_amount: ticket.groupSummary.total_amount
      };
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Error validating ticket:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET GROUP BY OPERATION CODE ─────────────────────────────
const getGroupByCode = async (req, res) => {
  try {
    const { operationCode } = req.params;

    const summary = await prisma.groupSummary.findUnique({
      where: { operation_code: operationCode },
      include: {
        cajero: { select: { id: true, email: true } },
        tickets: {
          include: {
            createdBy: { select: { id: true, email: true } }
          },
          orderBy: { id: 'asc' }
        }
      }
    });

    if (!summary) {
      return res.status(404).json({ message: 'Grupo no encontrado' });
    }

    res.status(200).json({ summary });
  } catch (error) {
    console.error('Error fetching group:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET ONE ─────────────────────────────────────────────────
const getTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const ticket = await prisma.ticket.findUnique({
      where: { id: parseInt(id) },
      include: {
        scans: { include: { guard: { select: { id: true, email: true } } } },
        createdBy: { select: { id: true, email: true } },
        groupSummary: true
      }
    });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    res.status(200).json({ ticket });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── LIST (enhanced filters) ─────────────────────────────────
const listTickets = async (req, res) => {
  try {
    const { status, date, date_from, date_to, visitor_type, payment_method, page = 1, limit = 50 } = req.query;
    const where = {};

    if (status && ['ACTIVE', 'USED', 'CANCELLED'].includes(status)) where.status = status;
    if (visitor_type && VALID_VISITOR_TYPES.includes(visitor_type)) where.visitor_type = visitor_type;
    if (payment_method && VALID_PAYMENT.includes(payment_method)) where.payment_method = payment_method;

    // Single date (legacy) or range
    if (date) {
      const s = new Date(date); s.setHours(0, 0, 0, 0);
      const e = new Date(date); e.setHours(23, 59, 59, 999);
      where.visit_date = { gte: s, lte: e };
    } else if (date_from || date_to) {
      where.visit_date = {};
      if (date_from) { const s = new Date(date_from); s.setHours(0, 0, 0, 0); where.visit_date.gte = s; }
      if (date_to)   { const e = new Date(date_to);   e.setHours(23, 59, 59, 999); where.visit_date.lte = e; }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: { createdBy: { select: { id: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.ticket.count({ where })
    ]);

    res.status(200).json({ tickets, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error('Error listing tickets:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── CANCEL ──────────────────────────────────────────────────
const cancelTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const ticket = await prisma.ticket.findUnique({ where: { id: parseInt(id) } });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    if (ticket.status === 'CANCELLED') return res.status(400).json({ message: 'Ticket is already cancelled' });
    if (ticket.status === 'USED') return res.status(400).json({ message: 'Cannot cancel a used ticket' });

    const updated = await prisma.ticket.update({ where: { id: parseInt(id) }, data: { status: 'CANCELLED' } });
    res.status(200).json({ message: 'Ticket cancelled', ticket: updated });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = { createTicket, validateTicket, getTicket, listTickets, cancelTicket, getGroupByCode };
