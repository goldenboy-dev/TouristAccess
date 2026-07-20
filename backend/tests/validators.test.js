import { describe, it, expect } from 'vitest';
import { createTicketSchema, listTicketsQuerySchema, cancelTicketSchema } from '../src/validators/ticket.validator.js';
import {
  cashierHistoryQuerySchema,
  evolutionQuerySchema,
  alertsQuerySchema,
  auditLogQuerySchema,
  suspiciousOperationsQuerySchema,
  updateUserNameSchema,
  updateOperatingSettingsSchema,
} from '../src/validators/dashboard.validator.js';

const today = () => new Date().toISOString().slice(0, 10);

const validBody = (overrides = {}) => ({
  payment_method: 'CASH',
  visit_date: today(),
  number_of_adults: 1,
  ...overrides,
});

describe('createTicketSchema', () => {
  it('accepts a minimal valid operation', () => {
    const result = createTicketSchema.safeParse(validBody());
    expect(result.success).toBe(true);
  });

  it('coerces the string counts an HTML form sends', () => {
    const result = createTicketSchema.safeParse(validBody({ number_of_adults: '2', number_of_children: '1' }));
    expect(result.success).toBe(true);
    expect(result.data.number_of_adults).toBe(2);
    expect(result.data.number_of_children).toBe(1);
  });

  it('rejects an operation with nobody in it', () => {
    const result = createTicketSchema.safeParse(validBody({ number_of_adults: 0 }));
    expect(result.success).toBe(false);
  });

  it('rejects an unknown payment method with the Spanish message', () => {
    const result = createTicketSchema.safeParse(validBody({ payment_method: 'CRYPTO' }));
    expect(result.success).toBe(false);
    // Zod 4 uses `error`, not `errorMap` — with the old key this message was
    // silently replaced by Zod's English default.
    expect(result.error.issues[0].message).toMatch(/Método de pago debe ser/);
  });

  it('rejects HTML in the customer name', () => {
    const result = createTicketSchema.safeParse(validBody({ customer_name: '<script>alert(1)</script>' }));
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toMatch(/HTML/);
  });

  it('rejects a visit date outside the ±7 day window', () => {
    const far = new Date(); far.setDate(far.getDate() + 8);
    const result = createTicketSchema.safeParse(validBody({ visit_date: far.toISOString().slice(0, 10) }));
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toMatch(/7 días/);
  });

  it('accepts a visit date inside the window', () => {
    const soon = new Date(); soon.setDate(soon.getDate() + 3);
    const result = createTicketSchema.safeParse(validBody({ visit_date: soon.toISOString().slice(0, 10) }));
    expect(result.success).toBe(true);
  });

  it('requires one cédula per local', () => {
    const result = createTicketSchema.safeParse(validBody({ number_of_locals: 2, locals_cedulas: ['4123456'] }));
    expect(result.success).toBe(false);
  });

  it('rejects an empty cédula string', () => {
    const result = createTicketSchema.safeParse(validBody({ number_of_locals: 1, locals_cedulas: [''] }));
    expect(result.success).toBe(false);
  });

  it('rejects an operation over 50 people', () => {
    const result = createTicketSchema.safeParse(validBody({ number_of_adults: 30, number_of_children: 30 }));
    expect(result.success).toBe(false);
  });
});

describe('cancelTicketSchema', () => {
  it('accepts a valid reason', () => {
    const result = cancelTicketSchema.safeParse({ reason: 'Cliente pidió reembolso' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing reason', () => {
    const result = cancelTicketSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a too-short reason', () => {
    const result = cancelTicketSchema.safeParse({ reason: 'no' });
    expect(result.success).toBe(false);
  });

  it('rejects HTML in the reason', () => {
    const result = cancelTicketSchema.safeParse({ reason: '<script>alert(1)</script>' });
    expect(result.success).toBe(false);
  });
});

describe('listTicketsQuerySchema', () => {
  it('applies pagination defaults when the query is empty', () => {
    const result = listTicketsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ page: 1, limit: 50 });
  });

  it('coerces page and limit to numbers', () => {
    const result = listTicketsQuerySchema.safeParse({ page: '3', limit: '10' });
    expect(result.data).toMatchObject({ page: 3, limit: 10 });
  });

  it('caps limit so one request cannot pull the whole table', () => {
    expect(listTicketsQuerySchema.safeParse({ limit: '5000' }).success).toBe(false);
  });

  it('rejects a bogus status instead of silently ignoring it', () => {
    const result = listTicketsQuerySchema.safeParse({ status: 'PENDIENTE' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toMatch(/status debe ser/);
  });

  it('rejects a malformed date', () => {
    expect(listTicketsQuerySchema.safeParse({ date_from: '16-07-2026' }).success).toBe(false);
  });

  // The SPA sends `?status=&date_from=` for cleared filters.
  it('treats a cleared filter as absent', () => {
    const result = listTicketsQuerySchema.safeParse({ status: '', date_from: '', visitor_type: '' });
    expect(result.success).toBe(true);
    expect(result.data.status).toBeUndefined();
    expect(result.data.date_from).toBeUndefined();
  });
});

describe('cashierHistoryQuerySchema', () => {
  it('requires cajero_id', () => {
    const result = cashierHistoryQuerySchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toMatch(/cajero_id/);
  });

  // Used to reach Prisma as NaN and surface as a 500.
  it('rejects a non-numeric cajero_id', () => {
    expect(cashierHistoryQuerySchema.safeParse({ cajero_id: 'abc' }).success).toBe(false);
  });

  it('coerces cajero_id and defaults days to 30', () => {
    const result = cashierHistoryQuerySchema.safeParse({ cajero_id: '7' });
    expect(result.data).toEqual({ cajero_id: 7, days: 30 });
  });

  it('bounds the history window', () => {
    expect(cashierHistoryQuerySchema.safeParse({ cajero_id: '7', days: '0' }).success).toBe(false);
    expect(cashierHistoryQuerySchema.safeParse({ cajero_id: '7', days: '400' }).success).toBe(false);
    expect(cashierHistoryQuerySchema.safeParse({ cajero_id: '7', days: '365' }).success).toBe(true);
  });
});

describe('other dashboard query schemas', () => {
  it('defaults the evolution interval to 60 minutes', () => {
    expect(evolutionQuerySchema.safeParse({}).data.interval_minutes).toBe(60);
  });

  it('rejects an out-of-range evolution interval', () => {
    expect(evolutionQuerySchema.safeParse({ interval_minutes: '1' }).success).toBe(false);
    expect(evolutionQuerySchema.safeParse({ interval_minutes: '600' }).success).toBe(false);
  });

  it('accepts only known alert levels', () => {
    expect(alertsQuerySchema.safeParse({ nivel: 'CRITICO' }).success).toBe(true);
    expect(alertsQuerySchema.safeParse({ nivel: 'URGENTE' }).success).toBe(false);
  });

  it('accepts an empty date (the picker was cleared)', () => {
    const result = alertsQuerySchema.safeParse({ date: '' });
    expect(result.success).toBe(true);
    expect(result.data.date).toBeUndefined();
  });

  it('caps the audit-log page size', () => {
    expect(auditLogQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ limit: '200' }).data.limit).toBe(200);
  });

  it('accepts only known audit outcomes', () => {
    expect(auditLogQuerySchema.safeParse({ outcome: 'SUCCESS' }).success).toBe(true);
    expect(auditLogQuerySchema.safeParse({ outcome: 'MAYBE' }).success).toBe(false);
  });

  it('coerces an optional cajero_id filter', () => {
    expect(suspiciousOperationsQuerySchema.safeParse({ cajero_id: '4' }).data.cajero_id).toBe(4);
    expect(suspiciousOperationsQuerySchema.safeParse({}).data.cajero_id).toBeUndefined();
  });
});

describe('updateUserNameSchema', () => {
  it('trims the name', () => {
    expect(updateUserNameSchema.safeParse({ name: '  María González  ' }).data.name).toBe('María González');
  });

  it('rejects a name shorter than 2 characters after trimming', () => {
    expect(updateUserNameSchema.safeParse({ name: ' a ' }).success).toBe(false);
  });

  it('rejects HTML', () => {
    expect(updateUserNameSchema.safeParse({ name: '<b>Ana</b>' }).success).toBe(false);
  });
});

describe('updateOperatingSettingsSchema', () => {
  it('accepts a valid hours pair + capacity', () => {
    const result = updateOperatingSettingsSchema.safeParse({
      operating_hours_start: '07:00',
      operating_hours_end: '20:00',
      max_daily_capacity: 500,
    });
    expect(result.success).toBe(true);
    expect(result.data.max_daily_capacity).toBe(500);
  });

  it('coerces a string capacity from an HTML form', () => {
    const result = updateOperatingSettingsSchema.safeParse({ max_daily_capacity: '500' });
    expect(result.success).toBe(true);
    expect(result.data.max_daily_capacity).toBe(500);
  });

  it('treats an empty string as "clear this field", not zero', () => {
    const result = updateOperatingSettingsSchema.safeParse({
      operating_hours_start: '',
      operating_hours_end: '',
      max_daily_capacity: '',
    });
    expect(result.success).toBe(true);
    expect(result.data.operating_hours_start).toBeNull();
    expect(result.data.max_daily_capacity).toBeNull();
  });

  it('rejects an hours pair sent one-sided', () => {
    expect(updateOperatingSettingsSchema.safeParse({ operating_hours_start: '07:00' }).success).toBe(false);
  });

  it('rejects hours where start is not before end', () => {
    const result = updateOperatingSettingsSchema.safeParse({
      operating_hours_start: '20:00',
      operating_hours_end: '07:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed time string', () => {
    const result = updateOperatingSettingsSchema.safeParse({
      operating_hours_start: '7:00',
      operating_hours_end: '20:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a zero or negative capacity', () => {
    expect(updateOperatingSettingsSchema.safeParse({ max_daily_capacity: 0 }).success).toBe(false);
    expect(updateOperatingSettingsSchema.safeParse({ max_daily_capacity: -5 }).success).toBe(false);
  });

  it('accepts an empty body (nothing to update yet — the service rejects that separately)', () => {
    expect(updateOperatingSettingsSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a valid business_name', () => {
    const result = updateOperatingSettingsSchema.safeParse({ business_name: 'Parque Aventura' });
    expect(result.success).toBe(true);
    expect(result.data.business_name).toBe('Parque Aventura');
  });

  it('treats an empty business_name as "clear this field"', () => {
    const result = updateOperatingSettingsSchema.safeParse({ business_name: '' });
    expect(result.success).toBe(true);
    expect(result.data.business_name).toBeNull();
  });

  it('rejects a business_name that is too short or contains HTML', () => {
    expect(updateOperatingSettingsSchema.safeParse({ business_name: 'A' }).success).toBe(false);
    expect(updateOperatingSettingsSchema.safeParse({ business_name: '<b>Parque</b>' }).success).toBe(false);
  });
});
