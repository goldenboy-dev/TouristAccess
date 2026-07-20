/**
 * Printable-ticket rendering: QR image + standalone HTML document.
 *
 * Pure presentation — no database access, no request context. The HTML is
 * built in memory; writing it to disk is opt-in (TICKETS_HTML_DIR) because
 * the SPA renders and prints its own copy from the API response, so the
 * files are only useful for demos, debugging or a print daemon.
 */
const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');
const { logger } = require('../utils/logger');

// Unset (the default) means "never touch the disk".
const TICKETS_HTML_DIR = process.env.TICKETS_HTML_DIR || null;

function isHtmlPersistenceEnabled() {
  return Boolean(TICKETS_HTML_DIR);
}

// Sanitize strings before interpolating into HTML to prevent stored XSS.
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getVisitorLabel(type) {
  return { ADULT: 'Adulto', CHILD: 'Niño', LOCAL: 'Residente Local' }[type] || type;
}

function getVisitorColor(type) {
  return { ADULT: '#1d4ed8', CHILD: '#065f46', LOCAL: '#7c3aed' }[type] || '#6b7280';
}

function getVisitorBadgeBg(type) {
  return { ADULT: '#dbeafe', CHILD: '#d1fae5', LOCAL: '#ede9fe' }[type] || '#f3f4f6';
}

async function renderTicketQR(token) {
  return QRCode.toDataURL(token, {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

function renderTicketHTML(ticket, qrDataUrl, cashierEmail, businessName = 'Sistema de Entradas') {
  const typeLabel = getVisitorLabel(ticket.visitor_type);
  const visitDate = new Date(ticket.visit_date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const createdAt = new Date(ticket.createdAt).toLocaleString('es-ES');
  const badgeColor = getVisitorColor(ticket.visitor_type);
  const badgeBg = getVisitorBadgeBg(ticket.visitor_type);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ticket #${ticket.id} - ${escapeHtml(businessName)}</title>
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
    <h1>🎫 ${escapeHtml(businessName)}</h1>
    <p>Ticket de Acceso</p>
  </div>
  <div class="ticket-body">
    <div class="ticket-field">
      <span class="field-label">Cliente</span>
      <span class="field-value">${escapeHtml(ticket.customer_name)}</span>
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
      <span class="field-value">${escapeHtml(ticket.cedula)}</span>
    </div>` : ''}
    <div class="ticket-field">
      <span class="field-label">Fecha de Visita</span>
      <span class="field-value">${visitDate}</span>
    </div>
    <div class="ticket-field">
      <span class="field-label">Método de Pago</span>
      <span class="field-value">${escapeHtml(ticket.payment_method)}</span>
    </div>
    <div class="ticket-field">
      <span class="field-label">Cajero</span>
      <span class="field-value">${escapeHtml(cashierEmail)}</span>
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
    <div class="token">Token: ${escapeHtml(ticket.token)}</div>
  </div>
  <div class="ticket-footer">
    Ticket #${ticket.id} — Válido únicamente para la fecha indicada
  </div>
</div>
</body>
</html>`;
}

/**
 * Best-effort disk write. A failure here must never fail the sale: the ticket
 * is already committed and the customer is holding the QR from the response.
 * Returns the filename, or null if disabled/failed.
 */
async function persistTicketHTML(ticket, html) {
  if (!TICKETS_HTML_DIR) return null;

  const filename = `ticket_${ticket.id}.html`;
  try {
    await fs.mkdir(TICKETS_HTML_DIR, { recursive: true });
    await fs.writeFile(path.join(TICKETS_HTML_DIR, filename), html, 'utf8');
    return filename;
  } catch (error) {
    logger.error({ event: 'ticket.html.persist_failed', ticketId: ticket.id, dir: TICKETS_HTML_DIR, error: error.message });
    return null;
  }
}

module.exports = {
  renderTicketQR,
  renderTicketHTML,
  persistTicketHTML,
  isHtmlPersistenceEnabled,
  escapeHtml,
  TICKETS_HTML_DIR,
};
