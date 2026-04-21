const prisma = require('../utils/prisma');
const { generateSecureToken } = require('../utils/crypto');
const { randomUUID } = require('crypto');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// ─── Server-side pricing (NEVER trust frontend) ──────────────
const PRICING = { ADULT: 10000, CHILD: 0 };
const VALID_PAYMENT = ['CASH', 'TRANSFER', 'QR', 'CARD'];
const TICKETS_DEMO_DIR = path.join(__dirname, '..', '..', 'tickets_demo');

// ─── Printable ticket HTML generator ─────────────────────────
async function generateTicketHTML(ticket, qrDataUrl, cashierEmail) {
  const typeLabel = ticket.ticket_type === 'ADULT' ? 'Adulto' : 'Niño';
  const visitDate = new Date(ticket.visit_date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const createdAt = new Date(ticket.createdAt).toLocaleString('es-ES');

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
  .badge-adult { background:#dbeafe; color:#1d4ed8; }
  .badge-child { background:#d1fae5; color:#065f46; }
  .badge-active { background:#d1fae5; color:#065f46; }
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
      <span class="field-value"><span class="badge badge-${ticket.ticket_type.toLowerCase()}">${typeLabel}</span></span>
    </div>
    <div class="ticket-field">
      <span class="field-label">Precio</span>
      <span class="field-value">₲${ticket.price.toLocaleString('es-PY')}</span>
    </div>
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
      <span class="field-value"><span class="badge badge-active">ACTIVO</span></span>
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
    const { customer_name, visit_date, payment_method, number_of_adults = 0, number_of_children = 0 } = req.body;

    const adults = parseInt(number_of_adults) || 0;
    const children = parseInt(number_of_children) || 0;
    const qty = adults + children;

    if (!visit_date || !payment_method) {
      return res.status(400).json({ message: 'Missing required fields: visit_date, payment_method' });
    }
    if (qty <= 0) {
      return res.status(400).json({ message: 'Total tickets must be greater than 0' });
    }
    if (qty > 50) {
      return res.status(400).json({ message: 'Total tickets cannot exceed 50' });
    }
    if (!VALID_PAYMENT.includes(payment_method)) {
      return res.status(400).json({ message: 'payment_method must be CASH, TRANSFER, QR, or CARD' });
    }

    // Fetch cashier email for ticket printing
    const cashier = await prisma.user.findUnique({ where: { id: parseInt(req.user.id) }, select: { email: true } });

    const groupId = randomUUID();
    const ticketsToCreate = [];
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // Prepare tickets data
    let ticketIndex = 1;
    for (let i = 0; i < adults; i++) {
      const name = customer_name ? `${customer_name.trim()} #${ticketIndex}` : `VIS-${dateStr}-${ticketIndex.toString().padStart(2, '0')}`;
      ticketsToCreate.push({ type: 'ADULT', name, price: PRICING['ADULT'] });
      ticketIndex++;
    }
    for (let i = 0; i < children; i++) {
      const name = customer_name ? `${customer_name.trim()} #${ticketIndex}` : `VIS-${dateStr}-${ticketIndex.toString().padStart(2, '0')}`;
      ticketsToCreate.push({ type: 'CHILD', name, price: PRICING['CHILD'] });
      ticketIndex++;
    }

    const createdData = [];
    
    // Execute creation in an atomic transaction
    await prisma.$transaction(async (tx) => {
      for (const t of ticketsToCreate) {
        const token = generateSecureToken();
        const ticket = await tx.ticket.create({
          data: {
            token,
            customer_name: t.name,
            ticket_type: t.type,
            price: t.price,
            group_id: groupId,
            visit_date: new Date(visit_date),
            payment_method,
            createdById: parseInt(req.user.id)
          }
        });
        createdData.push(ticket);
      }
    });

    const responseTickets = [];
    let grandTotal = 0;
    
    for (const ticket of createdData) {
      const qrDataUrl = await QRCode.toDataURL(ticket.token, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
      const htmlFile = await generateTicketHTML(ticket, qrDataUrl, cashier.email);
      responseTickets.push({ ticket, qr: qrDataUrl, htmlFile });
      grandTotal += ticket.price;
    }

    res.status(201).json({ 
      message: `${qty} tickets created successfully`, 
      group_id: groupId,
      total: grandTotal,
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
    const { token } = req.body;

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return res.status(400).json({ message: 'Token is required' });
    }

    const cleanToken = token.trim();
    const ticket = await prisma.ticket.findUnique({ where: { token: cleanToken } });

    if (!ticket) return res.json({ status: 'invalid', message: 'Ticket no encontrado' });
    if (ticket.status === 'CANCELLED') return res.json({ status: 'invalid', message: 'Este ticket fue cancelado' });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const visitDate = new Date(ticket.visit_date); visitDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil(Math.abs(today - visitDate) / 86400000);

    if (diffDays > 1) {
      return res.json({ status: 'invalid', message: `Ticket no válido para hoy (fecha: ${visitDate.toLocaleDateString('es-ES')})` });
    }

    if (ticket.status === 'USED') {
      const lastScan = await prisma.scan.findFirst({ where: { ticketId: ticket.id }, orderBy: { scannedAt: 'desc' } });
      return res.json({ status: 'already_used', message: 'Este ticket ya fue utilizado', ticket: { customer_name: ticket.customer_name, ticket_type: ticket.ticket_type, usedAt: lastScan?.scannedAt || ticket.updatedAt } });
    }

    const updated = await prisma.ticket.updateMany({ where: { id: ticket.id, status: 'ACTIVE' }, data: { status: 'USED' } });
    if (updated.count === 0) return res.json({ status: 'already_used', message: 'Este ticket acaba de ser validado por otro guardia' });

    await prisma.scan.create({ data: { ticketId: ticket.id, guardId: req.user.id } });

    res.status(200).json({ status: 'valid', message: 'Acceso permitido', ticket: { id: ticket.id, customer_name: ticket.customer_name, ticket_type: ticket.ticket_type, price: ticket.price } });
  } catch (error) {
    console.error('Error validating ticket:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET ONE ─────────────────────────────────────────────────
const getTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const ticket = await prisma.ticket.findUnique({
      where: { id: parseInt(id) },
      include: { scans: { include: { guard: { select: { id: true, email: true } } } }, createdBy: { select: { id: true, email: true } } }
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
    const { status, date, date_from, date_to, ticket_type, payment_method, page = 1, limit = 50 } = req.query;
    const where = {};

    if (status && ['ACTIVE', 'USED', 'CANCELLED'].includes(status)) where.status = status;
    if (ticket_type && ['ADULT', 'CHILD'].includes(ticket_type)) where.ticket_type = ticket_type;
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
      prisma.ticket.findMany({ where, include: { createdBy: { select: { id: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit) }),
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

module.exports = { createTicket, validateTicket, getTicket, listTickets, cancelTicket };
