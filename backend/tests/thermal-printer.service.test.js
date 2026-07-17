import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
import { printTicket } from '../src/services/thermal-printer.service.js';

// No real thermal printer exists in this environment. What IS verified here
// is the actual wire protocol: node-thermal-printer opens a real TCP socket
// and writes real ESC/POS bytes to it (see network.js in the library) — a
// bare `net.createServer` listener plays the role of the printer's TCP stack
// well enough to prove the bytes actually leave the process and contain the
// ticket's data. Whether a real Epson/Star unit renders/cuts correctly is a
// separate claim this test cannot make.

const sampleTicket = (overrides = {}) => ({
  id: 777,
  token: 'tok_' + 'x'.repeat(40),
  customer_name: 'Ana Ruiz',
  visitor_type: 'ADULT',
  price: 15000,
  payment_method: 'CASH',
  cedula: null,
  visit_date: new Date(2026, 6, 17),
  ...overrides,
});

afterEach(() => {
  delete process.env.THERMAL_PRINTING_ENABLED;
  delete process.env.PRINTER_IP;
  delete process.env.PRINTER_PORT;
});

describe('printTicket — configuration guards', () => {
  it('refuses to print when thermal printing is disabled', async () => {
    await expect(printTicket(sampleTicket())).rejects.toMatchObject({
      statusCode: 503,
      code: 'THERMAL_PRINTING_DISABLED',
    });
  });

  it('refuses to print when enabled but no printer is configured', async () => {
    process.env.THERMAL_PRINTING_ENABLED = 'true';

    await expect(printTicket(sampleTicket())).rejects.toMatchObject({
      statusCode: 503,
      code: 'PRINTER_NOT_CONFIGURED',
    });
  });

  it('reports 503 (not a 500) when the configured printer is unreachable', async () => {
    process.env.THERMAL_PRINTING_ENABLED = 'true';
    process.env.PRINTER_IP = '127.0.0.1';
    process.env.PRINTER_PORT = '1'; // nothing listens here

    await expect(printTicket(sampleTicket())).rejects.toMatchObject({
      statusCode: 503,
      code: 'PRINTER_UNREACHABLE',
    });
  }, 10000);
});

describe('printTicket — real TCP wire protocol', () => {
  // Stands in for the printer's raw TCP listener on port 9100.
  function startFakePrinter() {
    return new Promise((resolve) => {
      const chunks = [];
      const server = net.createServer((socket) => {
        socket.on('data', (chunk) => chunks.push(chunk));
      });
      server.listen(0, '127.0.0.1', () => {
        resolve({ server, port: server.address().port, chunks });
      });
    });
  }

  it('sends ESC/POS bytes containing the ticket data to the socket', async () => {
    const { server, port, chunks } = await startFakePrinter();
    process.env.THERMAL_PRINTING_ENABLED = 'true';
    process.env.PRINTER_IP = '127.0.0.1';
    process.env.PRINTER_PORT = String(port);

    try {
      await printTicket(sampleTicket(), 'cajero1@touristaccess.test');

      // Give the last write's 'close' a tick to land in `chunks`.
      await new Promise((r) => setTimeout(r, 50));

      const sent = Buffer.concat(chunks).toString('latin1');
      expect(sent.length).toBeGreaterThan(0);
      expect(sent).toContain('CERRO YAGUAR'); // header, minus the accented Ó (encoding-sensitive)
      expect(sent).toContain('777'); // ticket id
      expect(sent).toContain('tok_'); // token, embedded raw in the QR command payload
    } finally {
      server.close();
    }
  });
});
