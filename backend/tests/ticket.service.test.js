import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockModule, loadModule } from './helpers/cjs-mock.js';

// In-memory stand-in for the Prisma client. Every test wires only the calls it
// needs, so an unexpected query fails loudly instead of silently returning
// undefined.
const prismaMock = {
  ticket: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() },
  scan: { findFirst: vi.fn(), create: vi.fn() },
  groupSummary: { create: vi.fn(), findUnique: vi.fn() },
  // No row by default: getPricing() falls back to the ADULT_PRICE env var
  // (set to 10000 in vitest.config.mjs) — same value PRICING.ADULT used to be.
  // findMany defaults to [] — settings.service.getOperatingSettings() then
  // reports "unconfigured", so createTicketGroup/validateTicketByToken (which
  // now call it unconditionally) stay unrestricted for every test that
  // doesn't care about hours/aforo.
  appSetting: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
};

// Must be primed before the service is loaded: it captures the client at
// require time.
mockModule('src/utils/prisma.js', prismaMock);

const ticketService = loadModule('src/services/ticket.service.js');
// Matches the ADULT_PRICE env fallback used when no AppSetting row exists.
const ADULT_PRICE = 10000;

const activeTicket = (overrides = {}) => ({
  id: 42,
  token: 'a'.repeat(64),
  customer_name: 'Ana Ruiz',
  visitor_type: 'ADULT',
  price: 10000,
  status: 'ACTIVE',
  group_id: 'group-1',
  cedula: null,
  createdById: 3,
  visit_date: new Date(),
  updatedAt: new Date(),
  groupSummary: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks() clears call history but NOT a queued mockResolvedValue,
  // so a test that configures hours/aforo would otherwise leak its override
  // into every test that runs after it. Re-arm the "unconfigured" default
  // every time so operating-hours tests are isolated regardless of order.
  prismaMock.appSetting.findMany.mockResolvedValue([]);
});

// ─── Pricing / payment flow ──────────────────────────────────
describe('buildTicketRows (pricing)', () => {
  const rowsFor = (opts) => ticketService.buildTicketRows({
    adults: 0, children: 0, locals: 0,
    customer_name: undefined, childrenCedulas: [], localsCedulas: [],
    pricing: { ADULT_PRICE, CHILD_PRICE: 0, LOCAL_PRICE: 0 },
    ...opts,
  });

  it('charges the adult price only to adults', () => {
    const rows = rowsFor({ adults: 2, children: 3, locals: 1, localsCedulas: ['4123456'] });

    expect(rows.filter(r => r.type === 'ADULT').every(r => r.price === ADULT_PRICE)).toBe(true);
    expect(rows.filter(r => r.type !== 'ADULT').every(r => r.price === 0)).toBe(true);
  });

  it('totals the operation from the adult count alone', () => {
    const rows = rowsFor({ adults: 4, children: 6, locals: 2, localsCedulas: ['1', '2'] });
    const total = rows.reduce((sum, r) => sum + r.price, 0);

    expect(total).toBe(4 * ADULT_PRICE);
    expect(rows).toHaveLength(12);
  });

  it('numbers each person off the customer name', () => {
    const rows = rowsFor({ adults: 2, customer_name: '  Familia Ruiz  ' });
    expect(rows.map(r => r.name)).toEqual(['Familia Ruiz #1', 'Familia Ruiz #2']);
  });

  it('falls back to a generated code when there is no customer name', () => {
    const rows = rowsFor({ adults: 1 });
    expect(rows[0].name).toMatch(/^VIS-\d{8}-01$/);
  });

  // toISOString() would stamp tomorrow's date on a ticket sold after 21:00 local.
  it('stamps the local date on the generated code, not the UTC one', () => {
    const now = new Date();
    const localStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    expect(rowsFor({ adults: 1 })[0].name).toBe(`VIS-${localStamp}-01`);
  });

  it('keeps numbering continuous across visitor types', () => {
    const rows = rowsFor({ adults: 1, children: 1, locals: 1, customer_name: 'Grupo', localsCedulas: ['4123456'] });
    expect(rows.map(r => r.name)).toEqual(['Grupo #1', 'Grupo #2', 'Grupo #3']);
  });

  it('attaches the cédula to each local, in order', () => {
    const rows = rowsFor({ locals: 2, localsCedulas: [' 4123456 ', '5987654'] });
    expect(rows.map(r => r.cedula)).toEqual(['4123456', '5987654']);
  });

  it('leaves the cédula null for a child without one', () => {
    const rows = rowsFor({ children: 2, childrenCedulas: ['1234567'] });
    expect(rows.map(r => r.cedula)).toEqual(['1234567', null]);
  });
});

describe('assertCreateInvariants', () => {
  const today = new Date().toISOString().slice(0, 10);
  const valid = { adults: 1, children: 0, locals: 0, payment_method: 'CASH', customer_name: 'Ana', visit_date: today };

  it('accepts a well-formed operation', () => {
    expect(() => ticketService.assertCreateInvariants(valid)).not.toThrow();
  });

  it('rejects an empty operation', () => {
    expect(() => ticketService.assertCreateInvariants({ ...valid, adults: 0 }))
      .toThrow(/mayor a 0/);
  });

  it('rejects more than 50 people', () => {
    expect(() => ticketService.assertCreateInvariants({ ...valid, adults: 51 }))
      .toThrow(/no puede superar 50/);
  });

  it('rejects an unknown payment method', () => {
    expect(() => ticketService.assertCreateInvariants({ ...valid, payment_method: 'CRYPTO' }))
      .toThrow(/payment_method/);
  });

  it('rejects HTML in the customer name', () => {
    expect(() => ticketService.assertCreateInvariants({ ...valid, customer_name: '<img src=x onerror=alert(1)>' }))
      .toThrow(/HTML/);
  });

  it('rejects a visit date further than 7 days out', () => {
    const far = new Date(); far.setDate(far.getDate() + 30);
    expect(() => ticketService.assertCreateInvariants({ ...valid, visit_date: far.toISOString().slice(0, 10) }))
      .toThrow(/7 días/);
  });

  it('rejects an unparseable visit date', () => {
    expect(() => ticketService.assertCreateInvariants({ ...valid, visit_date: 'mañana' }))
      .toThrow(/formato inválido/);
  });

  it('throws AppError with a 400 so the handler does not turn it into a 500', () => {
    try {
      ticketService.assertCreateInvariants({ ...valid, adults: 0 });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.isOperational).toBe(true);
    }
  });
});

describe('createTicketGroup', () => {
  it('prices the group server-side and ignores anything the client sends', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: 'ana@yaguaron.py' });
    const summary = { id: 5, operation_code: 'abc12345' };
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      groupSummary: { create: vi.fn().mockResolvedValue(summary) },
      ticket: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, createdAt: new Date(), ...data })) },
    }));

    const result = await ticketService.createTicketGroup({
      cashierId: 3,
      input: {
        customer_name: 'Ana',
        visit_date: new Date().toISOString().slice(0, 10),
        payment_method: 'CASH',
        number_of_adults: 3,
        number_of_children: 2,
        number_of_locals: 0,
        price: 1, // client-supplied price must never be honoured
        total: 1,
      },
    });

    expect(result.totalAmount).toBe(3 * ADULT_PRICE);
    expect(result.qty).toBe(5);
    expect(result.tickets).toHaveLength(5);
  });

  it('refuses locals without a cédula for each one', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: 'ana@yaguaron.py' });

    await expect(ticketService.createTicketGroup({
      cashierId: 3,
      input: {
        visit_date: new Date().toISOString().slice(0, 10),
        payment_method: 'CASH',
        number_of_locals: 2,
        locals_cedulas: ['4123456'],
      },
    })).rejects.toThrow(/Se requieren 2 cédula/);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // Regression: visit_date used to be stored as UTC midnight, so in Paraguay
  // (UTC-3/-4) a ticket sold for today was stored as yesterday and the guard
  // rejected it as "no válido para hoy".
  it('stores the visit date at LOCAL midnight so the gate accepts it today', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: 'ana@yaguaron.py' });
    const created = [];
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      groupSummary: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 5, ...data })) },
      ticket: {
        create: vi.fn().mockImplementation(({ data }) => {
          created.push(data);
          return Promise.resolve({ id: created.length, createdAt: new Date(), ...data });
        }),
      },
    }));

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    await ticketService.createTicketGroup({
      cashierId: 3,
      input: { visit_date: todayStr, payment_method: 'CASH', number_of_adults: 1 },
    });

    const stored = created[0].visit_date;
    expect(stored.getHours()).toBe(0);
    expect(stored.getDate()).toBe(today.getDate());

    // And the guard's own check agrees it is for today.
    const storedDay = new Date(stored); storedDay.setHours(0, 0, 0, 0);
    const localToday = new Date(); localToday.setHours(0, 0, 0, 0);
    expect(storedDay.getTime()).toBe(localToday.getTime());
  });

  it('refuses a blank cédula', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: 'ana@yaguaron.py' });

    await expect(ticketService.createTicketGroup({
      cashierId: 3,
      input: {
        visit_date: new Date().toISOString().slice(0, 10),
        payment_method: 'CASH',
        number_of_locals: 1,
        locals_cedulas: ['   '],
      },
    })).rejects.toThrow(/obligatoria/);
  });
});

// ─── Cancellation (Bug 1: the UPDATE never ran) ──────────────
describe('cancelTicketById', () => {
  it('writes the cancellation to the database', async () => {
    const ticket = activeTicket();
    prismaMock.ticket.findUnique
      .mockResolvedValueOnce(ticket)
      .mockResolvedValueOnce({ ...ticket, status: 'CANCELLED' });
    prismaMock.ticket.updateMany.mockResolvedValue({ count: 1 });

    const { previous, updated } = await ticketService.cancelTicketById({ id: '42' });

    expect(prismaMock.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 42, status: 'ACTIVE' },
      data: {
        status: 'CANCELLED',
        cancelled_by_id: undefined,
        cancelled_at: expect.any(Date),
        cancellation_reason: undefined,
      },
    });
    expect(previous.status).toBe('ACTIVE');
    expect(updated.status).toBe('CANCELLED');
  });

  // Full traceability: who cancelled it and why has to land on the ticket
  // row itself, not only in the (harder to report on) audit log.
  it('persists who cancelled it, when, and why', async () => {
    const ticket = activeTicket();
    prismaMock.ticket.findUnique
      .mockResolvedValueOnce(ticket)
      .mockResolvedValueOnce({ ...ticket, status: 'CANCELLED' });
    prismaMock.ticket.updateMany.mockResolvedValue({ count: 1 });

    await ticketService.cancelTicketById({ id: '42', reason: 'Cliente no llegó', cancelledById: 7 });

    expect(prismaMock.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 42, status: 'ACTIVE' },
      data: {
        status: 'CANCELLED',
        cancelled_by_id: 7,
        cancelled_at: expect.any(Date),
        cancellation_reason: 'Cliente no llegó',
      },
    });
  });

  it('404s for a ticket that does not exist', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    await expect(ticketService.cancelTicketById({ id: '999' })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prismaMock.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to cancel an already cancelled ticket', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket({ status: 'CANCELLED' }));

    await expect(ticketService.cancelTicketById({ id: '42' })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/ya fue cancelado/),
    });
    expect(prismaMock.ticket.updateMany).not.toHaveBeenCalled();
  });

  // Money already collected and the visitor already inside: cancelling would
  // erase the entry from every report.
  it('refuses to cancel a used ticket', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket({ status: 'USED' }));

    await expect(ticketService.cancelTicketById({ id: '42' })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/ya utilizado/),
    });
    expect(prismaMock.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('loses the race to a guard who scans between the read and the write', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket());
    prismaMock.ticket.updateMany.mockResolvedValue({ count: 0 }); // no longer ACTIVE

    await expect(ticketService.cancelTicketById({ id: '42' })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/cambió de estado/),
    });
  });
});

// ─── Validation at the gate ──────────────────────────────────
describe('validateTicketByToken', () => {
  const guardId = 8;

  it('rejects an unknown token without leaking it into the audit trail', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    const result = await ticketService.validateTicketByToken({ token: 'b'.repeat(64), guardId });

    expect(result.outcome).toBe('rejected');
    expect(result.response.status).toBe('invalid');
    expect(result.audit.reason).toBe('token_not_found');
    expect(result.audit.tokenPrefix).toHaveLength(8);
  });

  it('rejects a cancelled ticket', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket({ status: 'CANCELLED' }));

    const result = await ticketService.validateTicketByToken({ token: 'a'.repeat(64), guardId });

    expect(result.audit.reason).toBe('ticket_cancelled');
    expect(result.response.message).toMatch(/cancelado/);
  });

  it('rejects a ticket for another day', async () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket({ visit_date: tomorrow }));

    const result = await ticketService.validateTicketByToken({ token: 'a'.repeat(64), guardId });

    expect(result.audit.reason).toBe('wrong_date');
    expect(result.response.status).toBe('invalid');
  });

  it('rejects a ticket that was already used', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket({ status: 'USED' }));
    prismaMock.scan.findFirst.mockResolvedValue({ scannedAt: new Date('2026-07-16T09:00:00Z') });

    const result = await ticketService.validateTicketByToken({ token: 'a'.repeat(64), guardId });

    expect(result.response.status).toBe('already_used');
    expect(result.audit.reason).toBe('already_used');
  });

  it('asks the guard to confirm a free entry before letting it through', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket({ visitor_type: 'LOCAL', price: 0 }));

    const result = await ticketService.validateTicketByToken({ token: 'a'.repeat(64), guardId });

    expect(result.outcome).toBe('confirmation_required');
    expect(result.response.error).toBe('CONFIRMATION_REQUIRED');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('admits a free entry once confirmed and records who confirmed it', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket({ visitor_type: 'CHILD', price: 0 }));
    const txTicket = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
    const txScan = { create: vi.fn().mockResolvedValue({}) };
    prismaMock.$transaction.mockImplementation(async (fn) => fn({ ticket: txTicket, scan: txScan }));

    const result = await ticketService.validateTicketByToken({
      token: 'a'.repeat(64), freeConfirmed: true, guardId,
    });

    expect(result.outcome).toBe('valid');
    expect(result.isFreeEntry).toBe(true);
    expect(txTicket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 42, status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'USED', guard_id: guardId, free_confirmed: 'CONFIRMED' }),
    }));
    expect(txScan.create).toHaveBeenCalledWith({ data: { ticketId: 42, guardId } });
  });

  it('admits a paid adult without asking for confirmation', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket());
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      ticket: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      scan: { create: vi.fn().mockResolvedValue({}) },
    }));

    const result = await ticketService.validateTicketByToken({ token: 'a'.repeat(64), guardId });

    expect(result.outcome).toBe('valid');
    expect(result.isFreeEntry).toBe(false);
    expect(result.response.message).toBe('Acceso permitido');
  });

  // Two guards scanning the same QR at once: both pass the checks above, only
  // one may win the conditional UPDATE.
  it('lets only one of two simultaneous scans in', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket());
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      ticket: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      scan: { create: vi.fn() },
    }));

    const result = await ticketService.validateTicketByToken({ token: 'a'.repeat(64), guardId });

    expect(result.outcome).toBe('rejected');
    expect(result.response.status).toBe('already_used');
    expect(result.audit.reason).toBe('already_used_race');
  });

  it('propagates unexpected database errors instead of admitting the visitor', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket());
    prismaMock.$transaction.mockRejectedValue(new Error('connection reset'));

    await expect(ticketService.validateTicketByToken({ token: 'a'.repeat(64), guardId }))
      .rejects.toThrow('connection reset');
  });
});

// ─── Operating hours (Fase 5: horarios de operación) ─────────
describe('operating hours enforcement (validateTicketByToken)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('rejects a scan outside the configured operating hours, without even looking up the token', async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([
      { key: 'operating_hours_start', value: '07:00' },
      { key: 'operating_hours_end', value: '20:00' },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 17, 21, 0, 0)); // 21:00 local, after closing

    const result = await ticketService.validateTicketByToken({ token: 'a'.repeat(64), guardId: 8 });

    expect(result.outcome).toBe('rejected');
    expect(result.audit.reason).toBe('outside_operating_hours');
    expect(prismaMock.ticket.findUnique).not.toHaveBeenCalled();
  });

  it('admits a scan inside the configured operating hours', async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([
      { key: 'operating_hours_start', value: '07:00' },
      { key: 'operating_hours_end', value: '20:00' },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 17, 12, 0, 0)); // 12:00 local
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket());
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      ticket: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      scan: { create: vi.fn().mockResolvedValue({}) },
    }));

    const result = await ticketService.validateTicketByToken({ token: 'a'.repeat(64), guardId: 8 });

    expect(result.outcome).toBe('valid');
  });

  it('stays unrestricted when nobody has configured operating hours (default findMany: [])', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket());
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      ticket: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      scan: { create: vi.fn().mockResolvedValue({}) },
    }));

    const result = await ticketService.validateTicketByToken({ token: 'a'.repeat(64), guardId: 8 });

    expect(result.outcome).toBe('valid');
  });
});

// ─── Aforo máximo diario (Fase 5) ─────────────────────────────
describe('aforo enforcement (createTicketGroup)', () => {
  it('refuses a sale that would push the day over max_daily_capacity', async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([{ key: 'max_daily_capacity', value: '10' }]);
    prismaMock.ticket.count.mockResolvedValue(9);
    prismaMock.user.findUnique.mockResolvedValue({ email: 'ana@yaguaron.py' });

    await expect(ticketService.createTicketGroup({
      cashierId: 3,
      input: {
        visit_date: new Date().toISOString().slice(0, 10),
        payment_method: 'CASH',
        number_of_adults: 2, // 9 already sold + 2 > 10
      },
    })).rejects.toThrow(/Aforo máximo/);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('allows a sale that fits exactly at the remaining capacity', async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([{ key: 'max_daily_capacity', value: '10' }]);
    prismaMock.ticket.count.mockResolvedValue(9);
    prismaMock.user.findUnique.mockResolvedValue({ email: 'ana@yaguaron.py' });
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      groupSummary: { create: vi.fn().mockResolvedValue({ id: 5, operation_code: 'abc12345' }) },
      ticket: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, createdAt: new Date(), ...data })) },
    }));

    const result = await ticketService.createTicketGroup({
      cashierId: 3,
      input: {
        visit_date: new Date().toISOString().slice(0, 10),
        payment_method: 'CASH',
        number_of_adults: 1, // 9 + 1 === 10, exactly at cap
      },
    });

    expect(result.qty).toBe(1);
  });

  it('stays unrestricted when nobody has configured a cap (default findMany: [])', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: 'ana@yaguaron.py' });
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      groupSummary: { create: vi.fn().mockResolvedValue({ id: 5, operation_code: 'abc12345' }) },
      ticket: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, createdAt: new Date(), ...data })) },
    }));

    const result = await ticketService.createTicketGroup({
      cashierId: 3,
      input: {
        visit_date: new Date().toISOString().slice(0, 10),
        payment_method: 'CASH',
        number_of_adults: 5,
      },
    });

    expect(result.qty).toBe(5);
    expect(prismaMock.ticket.count).not.toHaveBeenCalled();
  });
});

// ─── IDOR ────────────────────────────────────────────────────
describe('IDOR protection', () => {
  it('stops a cashier from reading another cashier ticket', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket({ createdById: 99 }));

    await expect(ticketService.getTicketById({ id: '42', actor: { id: 3, role: 'CASHIER' } }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('lets an admin read any ticket', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(activeTicket({ createdById: 99 }));

    const ticket = await ticketService.getTicketById({ id: '42', actor: { id: 1, role: 'ADMIN' } });
    expect(ticket.id).toBe(42);
  });

  it('scopes a cashier ticket list to their own sales', async () => {
    prismaMock.ticket.findMany.mockResolvedValue([]);
    prismaMock.ticket.count.mockResolvedValue(0);

    await ticketService.listTickets({ filters: { page: 1, limit: 50 }, actor: { id: 3, role: 'CASHIER' } });

    expect(prismaMock.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdById: 3 } }),
    );
  });

  it('does not scope an admin ticket list', async () => {
    prismaMock.ticket.findMany.mockResolvedValue([]);
    prismaMock.ticket.count.mockResolvedValue(0);

    await ticketService.listTickets({ filters: { page: 1, limit: 50 }, actor: { id: 1, role: 'ADMIN' } });

    expect(prismaMock.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('404s a missing group before touching its cashier id', async () => {
    prismaMock.groupSummary.findUnique.mockResolvedValue(null);

    await expect(ticketService.getGroupByOperationCode({
      operationCode: 'nope', actor: { id: 3, role: 'CASHIER' },
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});
