/**
 * Generic Zod validation middlewares.
 * `validate` checks req.body, `validateQuery` checks req.query.
 * Both replace the source with the parsed/coerced data and return 400 with
 * per-field detail on failure.
 */
const { logger } = require('../utils/logger');

function formatIssues(error) {
  // Zod 4 exposes `issues`; the old `errors` alias is gone, and reading it
  // threw here — turning every 400 into a 500 with no field detail.
  return error.issues.map(e => ({
    field: e.path.join('.'),
    message: e.message,
  }));
}

function reject(req, res, errors, source) {
  logger.warn({
    requestId: req.requestId,
    ip: req.ip,
    event: 'validation.failed',
    path: req.path,
    source,
    errors,
  });

  return res.status(400).json({
    error: 'Datos inválidos',
    message: 'Datos inválidos',
    details: errors,
  });
}

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) return reject(req, res, formatIssues(result.error), 'body');

  req.body = result.data;
  next();
};

const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) return reject(req, res, formatIssues(result.error), 'query');

  // Express 5 exposes req.query through a getter with no setter, so a plain
  // assignment would be silently dropped (and the handler would keep reading
  // raw strings). Redefine the property to hand over the coerced values.
  Object.defineProperty(req, 'query', {
    value: result.data,
    writable: true,
    configurable: true,
    enumerable: true,
  });

  next();
};

module.exports = { validate, validateQuery };
