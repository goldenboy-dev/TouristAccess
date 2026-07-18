/**
 * Query-param schemas for the dashboard and anti-fraud endpoints.
 * Before these existed every handler re-implemented parseInt with its own
 * silent fallbacks, so `?days=abc` quietly became NaN and `?cajero_id=x`
 * reached Prisma as NaN and blew up as a 500.
 */
const { z } = require('zod');
const { optionalDate, optionalId, requiredId, boundedInt, optionalString, optionalEnum } = require('./query');
const { ROLES } = require('../constants/user');
const { TIME_RE } = require('../constants/settings');

const AUDIT_MAX_LIMIT = 200;

const updateUserNameSchema = z.object({
  name: z.string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no puede superar 100 caracteres')
    .refine((v) => !/<[^>]*>/.test(v), 'El nombre no puede contener HTML'),
});

const updateUserRoleSchema = z.object({
  role: z.enum(ROLES, { error: () => `Rol no válido. Valores permitidos: ${ROLES.join(', ')}` }),
});

const updateUserActiveSchema = z.object({
  active: z.boolean({ error: () => 'active debe ser true o false' }),
});

// Cordura, no un límite de negocio real: evita que un typo (ej. un cero de
// más) quede guardado como el precio de entrada sin que nadie lo note.
const updatePricingSchema = z.object({
  adult_price: z.coerce.number({ message: 'adult_price debe ser un número' })
    .int('adult_price debe ser un entero')
    .positive('adult_price debe ser mayor a 0')
    .max(10_000_000, 'adult_price no puede superar 10.000.000'),
});

// '' means "clear this field" (frontend leaves the input empty), distinct
// from "not sent at all" — the union keeps a real null from being coerced
// into 0 by z.coerce.number().
const emptyToNull = (v) => (v === '' ? null : v);

const updateOperatingSettingsSchema = z.object({
  operating_hours_start: z.preprocess(emptyToNull, z.union([
    z.null(),
    z.string().regex(TIME_RE, 'operating_hours_start debe tener formato HH:MM'),
  ])).optional(),
  operating_hours_end: z.preprocess(emptyToNull, z.union([
    z.null(),
    z.string().regex(TIME_RE, 'operating_hours_end debe tener formato HH:MM'),
  ])).optional(),
  max_daily_capacity: z.preprocess(emptyToNull, z.union([
    z.null(),
    z.coerce.number().int('max_daily_capacity debe ser un entero').positive('max_daily_capacity debe ser mayor a 0').max(100_000, 'max_daily_capacity no puede superar 100.000'),
  ])).optional(),
}).refine((d) => (d.operating_hours_start === undefined) === (d.operating_hours_end === undefined), {
  message: 'operating_hours_start y operating_hours_end deben enviarse juntos',
  path: ['operating_hours_end'],
}).refine((d) => {
  if (d.operating_hours_start === undefined) return true;
  return (d.operating_hours_start === null) === (d.operating_hours_end === null);
}, {
  message: 'operating_hours_start y operating_hours_end deben enviarse juntos (ambos con hora o ambos vacíos)',
  path: ['operating_hours_end'],
}).refine((d) => {
  if (!d.operating_hours_start || !d.operating_hours_end) return true;
  return d.operating_hours_start < d.operating_hours_end;
}, {
  message: 'operating_hours_start debe ser anterior a operating_hours_end',
  path: ['operating_hours_end'],
});

const cashReportQuerySchema = z.object({
  date_from: optionalDate('date_from'),
  date_to:   optionalDate('date_to'),
  cajero_id: optionalId('cajero_id'),
});

const statsQuerySchema = z.object({
  date_from: optionalDate('date_from'),
  date_to:   optionalDate('date_to'),
});

const auditLogQuerySchema = z.object({
  event:         optionalString(80),
  actor_id:      optionalId('actor_id'),
  outcome:       optionalEnum(['SUCCESS', 'FAILURE'], 'outcome debe ser SUCCESS o FAILURE'),
  resource_type: optionalString(40),
  date_from:     optionalDate('date_from'),
  date_to:       optionalDate('date_to'),
  page:  boundedInt({ min: 1, max: 100000, fallback: 1,  label: 'page' }),
  limit: boundedInt({ min: 1, max: AUDIT_MAX_LIMIT, fallback: 50, label: 'limit' }),
});

const fraudSummaryQuerySchema = z.object({
  date: optionalDate('date'),
});

const alertsQuerySchema = z.object({
  date:  optionalDate('date'),
  nivel: optionalEnum(['CRITICO', 'AVISO'], 'nivel debe ser CRITICO o AVISO'),
});

const evolutionQuerySchema = z.object({
  date: optionalDate('date'),
  // Blocks span the 07:00–20:00 operating window; below 5 minutes the chart is
  // noise, above 240 it is a single bar.
  interval_minutes: boundedInt({ min: 5, max: 240, fallback: 60, label: 'interval_minutes' }),
});

const suspiciousOperationsQuerySchema = z.object({
  date:      optionalDate('date'),
  cajero_id: optionalId('cajero_id'),
});

const cashierHistoryQuerySchema = z.object({
  cajero_id: requiredId('cajero_id'),
  days:      boundedInt({ min: 1, max: 365, fallback: 30, label: 'days' }),
});

module.exports = {
  updateUserNameSchema,
  updateUserRoleSchema,
  updateUserActiveSchema,
  updatePricingSchema,
  updateOperatingSettingsSchema,
  cashReportQuerySchema,
  statsQuerySchema,
  auditLogQuerySchema,
  fraudSummaryQuerySchema,
  alertsQuerySchema,
  evolutionQuerySchema,
  suspiciousOperationsQuerySchema,
  cashierHistoryQuerySchema,
  AUDIT_MAX_LIMIT,
};
