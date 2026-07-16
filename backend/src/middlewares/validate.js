/**
 * Generic Zod validation middleware.
 * Receives a Zod schema and validates req.body against it.
 * Returns 400 with descriptive errors on failure.
 */
const { logger } = require('../utils/logger');

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    // Zod 4 exposes `issues`; the old `errors` alias is gone, and reading it
    // threw here — turning every 400 into a 500 with no field detail.
    const errors = result.error.issues.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    logger.warn({
      requestId: req.requestId,
      ip: req.ip,
      event: 'validation.failed',
      path: req.path,
      errors,
    });

    return res.status(400).json({
      error: 'Datos inválidos',
      details: errors,
    });
  }

  // Replace body with parsed/coerced data
  req.body = result.data;
  next();
};

module.exports = { validate };
