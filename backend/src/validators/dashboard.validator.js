/**
 * Query-param schemas for the dashboard and anti-fraud endpoints.
 * Before these existed every handler re-implemented parseInt with its own
 * silent fallbacks, so `?days=abc` quietly became NaN and `?cajero_id=x`
 * reached Prisma as NaN and blew up as a 500.
 */
const { z } = require('zod');
const { optionalDate, optionalId, requiredId, boundedInt, optionalString, optionalEnum } = require('./query');

const AUDIT_MAX_LIMIT = 200;

const updateUserNameSchema = z.object({
  name: z.string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no puede superar 100 caracteres')
    .refine((v) => !/<[^>]*>/.test(v), 'El nombre no puede contener HTML'),
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
  statsQuerySchema,
  auditLogQuerySchema,
  fraudSummaryQuerySchema,
  alertsQuerySchema,
  evolutionQuerySchema,
  suspiciousOperationsQuerySchema,
  cashierHistoryQuerySchema,
  AUDIT_MAX_LIMIT,
};
