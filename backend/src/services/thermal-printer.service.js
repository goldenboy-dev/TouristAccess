/**
 * Real thermal-printer integration (ESC/POS over network, port 9100 —
 * "raw" printing, the de-facto standard for network thermal printers).
 *
 * Deliberately separate from ticket-render.service.js: that module builds a
 * ~400px HTML "card" meant for a screen/A4 print via window.print(), which
 * is a completely different rendering target than a 48/32-char-wide ESC/POS
 * receipt. Sharing one template between the two would mean neither renders
 * well anywhere.
 *
 * ⚠️ Verified against a TCP listener that speaks back at the socket level
 * (see tests), NOT against real ESC/POS hardware — there is none in this
 * environment. `printer.execute()` here is the same call a real Epson/Star/
 * generic ESC/POS network printer expects on port 9100; node-thermal-printer
 * is a widely used, actively maintained library for exactly this. But bytes
 * that look right and a printer that actually cuts paper in the right place
 * are two different claims — treat this as unverified against hardware until
 * someone runs it against the printer that ships with the deployment.
 */
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const { logger } = require('../utils/logger');
const { serviceUnavailable } = require('../utils/errors');
const { toLocalDateStr } = require('../utils/date');

const VISITOR_LABELS = { ADULT: 'ADULTO', CHILD: 'NIÑO', LOCAL: 'RESIDENTE LOCAL' };

function isEnabled() {
  return process.env.THERMAL_PRINTING_ENABLED === 'true';
}

function buildPrinter() {
  const host = process.env.PRINTER_IP;
  const port = process.env.PRINTER_PORT || '9100';
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${host}:${port}`,
    characterSet: CharacterSet.PC850_MULTILINGUAL, // covers ñ/á/é/í/ó/ú/¿/¡, unlike the PC437 default
    removeSpecialCharacters: false,
    width: Number(process.env.PRINTER_WIDTH) || 48, // ~48 cols @ font A on 80mm paper; 32 for 58mm
    options: { timeout: Number(process.env.PRINTER_TIMEOUT_MS) || 5000 },
  });
}

function money(amount) {
  return amount > 0 ? `Gs. ${amount.toLocaleString('es-PY')}` : 'GRATIS';
}

function buildReceipt(printer, ticket, cashierEmail) {
  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println('CERRO YAGUARÓN');
  printer.setTextNormal();
  printer.println('Acceso Turístico');
  printer.bold(false);
  printer.drawLine();

  printer.alignLeft();
  printer.bold(true);
  printer.println(VISITOR_LABELS[ticket.visitor_type] || ticket.visitor_type);
  printer.bold(false);
  printer.leftRight('Cliente:', ticket.customer_name || '-');
  printer.leftRight('Fecha visita:', toLocalDateStr(ticket.visit_date));
  printer.leftRight('Precio:', money(ticket.price));
  printer.leftRight('Pago:', ticket.payment_method);
  if (ticket.cedula) printer.leftRight('Cédula:', ticket.cedula);
  if (cashierEmail) printer.leftRight('Cajero/a:', cashierEmail.split('@')[0]);
  printer.leftRight('Ticket #:', String(ticket.id));
  printer.drawLine();

  printer.alignCenter();
  printer.printQR(ticket.token, { cellSize: 6, correction: 'M' });
  printer.newLine();
  printer.println('Presentar este código en la entrada');
  printer.newLine();
  printer.println('Válido únicamente para la fecha indicada');
  printer.newLine();
  printer.cut();
}

/**
 * Renders and sends a single ticket to the configured network printer.
 * Throws a 503 AppError (operational, not a server bug) if printing isn't
 * configured, the printer can't be reached, or the print job fails — a
 * cashier losing the printer mid-shift is an expected failure mode, not a
 * 500.
 */
async function printTicket(ticket, cashierEmail) {
  if (!isEnabled()) {
    throw serviceUnavailable('La impresión térmica no está habilitada en este servidor', { code: 'THERMAL_PRINTING_DISABLED' });
  }
  if (!process.env.PRINTER_IP) {
    throw serviceUnavailable('No hay una impresora térmica configurada (falta PRINTER_IP)', { code: 'PRINTER_NOT_CONFIGURED' });
  }

  const printer = buildPrinter();

  let connected = false;
  try {
    connected = await printer.isPrinterConnected();
  } catch (error) {
    logger.warn({ event: 'printer.connect_failed', ticketId: ticket.id, error: error.message });
  }
  if (!connected) {
    throw serviceUnavailable('La impresora térmica no responde. Revisá que esté encendida y conectada a la red.', { code: 'PRINTER_UNREACHABLE' });
  }

  buildReceipt(printer, ticket, cashierEmail);

  try {
    await printer.execute();
  } catch (error) {
    logger.warn({ event: 'printer.print_failed', ticketId: ticket.id, error: error.message });
    throw serviceUnavailable('Falló el envío a la impresora térmica. Intentá de nuevo.', { code: 'PRINTER_PRINT_FAILED' });
  }

  logger.info({ event: 'printer.print_succeeded', ticketId: ticket.id });
}

module.exports = { printTicket, isEnabled };
