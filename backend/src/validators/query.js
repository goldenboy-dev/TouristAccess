/**
 * Shared building blocks for query-string schemas.
 *
 * Query params arrive as strings and the SPA sends empty ones for cleared
 * filters (`?date=`), which every handler used to treat as "not set". These
 * helpers keep that contract while still rejecting genuinely bad input.
 */
const { z } = require('zod');
const { DATE_RE, parseLocalDate } = require('../utils/date');

// An empty string means "filter not applied", not "invalid value".
const blankToUndefined = (schema) => z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  schema,
);

// The regex alone would accept 2026-02-31; parseLocalDate rejects a day that
// does not exist, which the handlers downstream assume is impossible.
const optionalDate = (label = 'Fecha') => blankToUndefined(
  z.string()
    .regex(DATE_RE, `${label} debe tener formato YYYY-MM-DD`)
    .refine((v) => parseLocalDate(v) !== null, `${label} no es una fecha válida`)
    .optional(),
);

const optionalId = (label) => blankToUndefined(
  z.coerce.number({ message: `${label} debe ser un número` }).int().positive(`${label} debe ser un ID válido`).optional(),
);

const requiredId = (label) => z.coerce
  .number({ message: `${label} es obligatorio y debe ser un número` })
  .int()
  .positive(`${label} debe ser un ID válido`);

const boundedInt = ({ min, max, fallback, label }) => blankToUndefined(
  z.coerce.number({ message: `${label} debe ser un número` })
    .int()
    .min(min, `${label} debe ser mayor o igual a ${min}`)
    .max(max, `${label} no puede superar ${max}`)
    .default(fallback),
);

const optionalString = (max = 100) => blankToUndefined(z.string().max(max).optional());

const optionalEnum = (values, message) => blankToUndefined(z.enum(values, { error: message }).optional());

module.exports = {
  blankToUndefined,
  optionalDate,
  optionalId,
  requiredId,
  boundedInt,
  optionalString,
  optionalEnum,
};
