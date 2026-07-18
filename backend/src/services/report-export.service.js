/**
 * Cierre de caja en Excel/PDF — mismo dato que el CSV (`cash-report.service.js`
 * ya arma `rows`/`grandTotal`/`grandTotalTickets`), solo cambia el formato de
 * salida. A diferencia del CSV (armado a mano, sin dependencias) estos dos
 * formatos binarios sí justifican una librería: no hay forma razonable de
 * generar un .xlsx o un PDF con estructura de tabla a mano.
 */
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { PAYMENT_METHODS } = require('../constants/ticket');

const PAYMENT_LABELS = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', QR: 'QR' };

async function buildCashReportExcel({ rows, grandTotal, grandTotalTickets, date_from, date_to }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tourist Access';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Cierre de Caja');
  sheet.columns = [
    { header: 'Cajero', key: 'cajero', width: 26 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Total tickets', key: 'totalTickets', width: 14 },
    ...PAYMENT_METHODS.map((m) => ({ header: PAYMENT_LABELS[m], key: m, width: 16 })),
    { header: 'Total', key: 'total', width: 16 },
    { header: 'Cancelados', key: 'cancelled', width: 12 },
  ];

  sheet.insertRow(1, [`Cierre de Caja — período ${date_from} a ${date_to}`]);
  sheet.mergeCells(1, 1, 1, sheet.columns.length);
  sheet.getRow(1).font = { bold: true, size: 13 };
  sheet.getRow(2).values = sheet.columns.map((c) => c.header);
  sheet.getRow(2).font = { bold: true };
  sheet.getRow(2).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  });

  for (const row of rows) {
    sheet.addRow({
      cajero: row.cajeroNombre,
      email: row.cajeroEmail,
      totalTickets: row.totalTickets,
      ...Object.fromEntries(PAYMENT_METHODS.map((m) => [m, row.byMethod[m]])),
      total: row.totalAmount,
      cancelled: row.cancelledCount,
    });
  }

  const totalRow = sheet.addRow({ cajero: 'TOTAL', totalTickets: grandTotalTickets, total: grandTotal });
  totalRow.font = { bold: true };

  for (const key of ['CASH', 'CARD', 'TRANSFER', 'QR', 'total']) {
    sheet.getColumn(key).numFmt = '#,##0';
  }

  return workbook.xlsx.writeBuffer();
}

// pdfkit has no table primitive — columns are drawn at fixed x offsets.
const COLUMNS = [
  { key: 'cajero', label: 'Cajero', width: 120 },
  { key: 'email', label: 'Email', width: 150 },
  { key: 'totalTickets', label: 'Tickets', width: 55, align: 'right' },
  { key: 'CASH', label: 'Efectivo', width: 75, align: 'right' },
  { key: 'CARD', label: 'Tarjeta', width: 70, align: 'right' },
  { key: 'TRANSFER', label: 'Transf.', width: 80, align: 'right' },
  { key: 'QR', label: 'QR', width: 55, align: 'right' },
  { key: 'total', label: 'Total', width: 80, align: 'right' },
  { key: 'cancelled', label: 'Cancel.', width: 55, align: 'right' },
];
const TABLE_LEFT = 40;
const ROW_HEIGHT = 20;

function drawRow(doc, y, values, { bold = false } = {}) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
  let x = TABLE_LEFT;
  for (const col of COLUMNS) {
    doc.text(String(values[col.key] ?? ''), x, y, {
      width: col.width,
      align: col.align || 'left',
      lineBreak: false,
      ellipsis: true,
    });
    x += col.width;
  }
}

function buildCashReportPdf({ rows, grandTotal, grandTotalTickets, date_from, date_to }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageBottom = doc.page.height - doc.page.margins.bottom;

    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(16).text('Cierre de Caja — Tourist Access', TABLE_LEFT, 40);
      doc.font('Helvetica').fontSize(10).fillColor('#666')
        .text(`Período: ${date_from} a ${date_to}`, TABLE_LEFT, 62);
      doc.fillColor('#000');

      const headerY = 90;
      doc.rect(TABLE_LEFT, headerY - 4, COLUMNS.reduce((s, c) => s + c.width, 0), ROW_HEIGHT).fill('#e5e7eb');
      doc.fillColor('#000');
      drawRow(doc, headerY, Object.fromEntries(COLUMNS.map((c) => [c.key, c.label])), { bold: true });
      return headerY + ROW_HEIGHT;
    };

    let y = drawHeader();

    for (const row of rows) {
      if (y + ROW_HEIGHT > pageBottom) {
        doc.addPage();
        y = drawHeader();
      }
      drawRow(doc, y, {
        cajero: row.cajeroNombre,
        email: row.cajeroEmail,
        totalTickets: row.totalTickets,
        CASH: row.byMethod.CASH.toLocaleString('es-PY'),
        CARD: row.byMethod.CARD.toLocaleString('es-PY'),
        TRANSFER: row.byMethod.TRANSFER.toLocaleString('es-PY'),
        QR: row.byMethod.QR.toLocaleString('es-PY'),
        total: row.totalAmount.toLocaleString('es-PY'),
        cancelled: row.cancelledCount,
      });
      y += ROW_HEIGHT;
    }

    if (y + ROW_HEIGHT > pageBottom) {
      doc.addPage();
      y = drawHeader();
    }
    y += 4;
    drawRow(doc, y, {
      cajero: 'TOTAL',
      totalTickets: grandTotalTickets,
      total: grandTotal.toLocaleString('es-PY'),
    }, { bold: true });

    doc.end();
  });
}

module.exports = { buildCashReportExcel, buildCashReportPdf };
