import { describe, it, expect } from 'vitest';
import { loadModule } from './helpers/cjs-mock.js';

// Pure presentation, no DB — same category as ticket-render.service.js.
const reportExportService = loadModule('src/services/report-export.service.js');

const sampleReport = {
  rows: [
    {
      cajeroNombre: 'Cajero Uno',
      cajeroEmail: 'cajero1@tourist.com',
      totalTickets: 5,
      byMethod: { CASH: 30000, CARD: 10000, TRANSFER: 0, QR: 5000 },
      totalAmount: 45000,
      cancelledCount: 1,
    },
    {
      cajeroNombre: 'Cajero <script>Dos</script>',
      cajeroEmail: 'cajero2@tourist.com',
      totalTickets: 2,
      byMethod: { CASH: 0, CARD: 0, TRANSFER: 20000, QR: 0 },
      totalAmount: 20000,
      cancelledCount: 0,
    },
  ],
  grandTotal: 65000,
  grandTotalTickets: 7,
  date_from: '2026-07-01',
  date_to: '2026-07-17',
};

describe('buildCashReportExcel', () => {
  it('produces a valid xlsx buffer (ZIP magic bytes)', async () => {
    const buffer = await reportExportService.buildCashReportExcel(sampleReport);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // .xlsx is a ZIP container: 'PK' signature.
    expect(buffer.slice(0, 2).toString('ascii')).toBe('PK');
  });

  it('handles an empty report without throwing', async () => {
    const buffer = await reportExportService.buildCashReportExcel({
      rows: [], grandTotal: 0, grandTotalTickets: 0, date_from: 'hoy', date_to: 'hoy',
    });
    expect(buffer.length).toBeGreaterThan(0);
  });
});

describe('buildCashReportPdf', () => {
  it('produces a valid PDF buffer (%PDF header)', async () => {
    const buffer = await reportExportService.buildCashReportPdf(sampleReport);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('handles an empty report without throwing', async () => {
    const buffer = await reportExportService.buildCashReportPdf({
      rows: [], grandTotal: 0, grandTotalTickets: 0, date_from: 'hoy', date_to: 'hoy',
    });
    expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('paginates past a single page worth of rows without throwing', async () => {
    const manyRows = Array.from({ length: 60 }, (_, i) => ({
      cajeroNombre: `Cajero ${i}`,
      cajeroEmail: `cajero${i}@tourist.com`,
      totalTickets: 1,
      byMethod: { CASH: 10000, CARD: 0, TRANSFER: 0, QR: 0 },
      totalAmount: 10000,
      cancelledCount: 0,
    }));
    const buffer = await reportExportService.buildCashReportPdf({
      rows: manyRows, grandTotal: 600000, grandTotalTickets: 60, date_from: 'hoy', date_to: 'hoy',
    });
    expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
  });
});
