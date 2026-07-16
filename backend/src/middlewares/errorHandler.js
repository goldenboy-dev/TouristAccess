/**
 * Centralized error handler — last middleware in the Express chain.
 * Never exposes stack traces to the client.
 * Logs full error details internally for debugging.
 */
const { logger } = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  const requestId = req.requestId || 'unknown';

  const logContext = {
    requestId,
    userId: req.user?.id,
    role:   req.user?.role,
    ip:     req.ip,
    method: req.method,
    path:   req.path,
    error:  err.message,
  };

  // Operational errors (AppError) — safe to show message to client.
  // Logged at warn without a stack: a 404 or a rejected password is expected
  // traffic, not a failure of the server, and stacks here would bury real ones.
  if (err.isOperational) {
    logger.warn({ ...logContext, event: 'request.rejected', statusCode: err.statusCode, code: err.code });

    return res.status(err.statusCode).json({
      // `error` is the canonical field; `message` is kept because the SPA and
      // the printable-ticket flow already read it.
      ...(err.details || {}),
      error: err.message,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      requestId,
    });
  }

  logger.error({ ...logContext, stack: err.stack });

  // CORS errors
  if (err.message === 'Origen no permitido por CORS') {
    return res.status(403).json({
      error: 'Origen no permitido',
      message: 'Origen no permitido',
      requestId,
    });
  }

  // Unexpected errors — generic message, never expose details
  return res.status(500).json({
    error: 'Error interno del servidor',
    message: 'Error interno del servidor',
    requestId,
  });
};

module.exports = { errorHandler };
