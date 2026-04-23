/**
 * Centralized error handler — last middleware in the Express chain.
 * Never exposes stack traces to the client.
 * Logs full error details internally for debugging.
 */
const { logger } = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  const requestId = req.requestId || 'unknown';

  // Log the full error internally
  logger.error({
    requestId,
    userId: req.user?.id,
    role:   req.user?.role,
    ip:     req.ip,
    method: req.method,
    path:   req.path,
    error:  err.message,
    stack:  err.stack,
  });

  // Operational errors (AppError) — safe to show message to client
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message,
      requestId,
    });
  }

  // CORS errors
  if (err.message === 'Origen no permitido por CORS') {
    return res.status(403).json({
      error: 'Origen no permitido',
      requestId,
    });
  }

  // Unexpected errors — generic message, never expose details
  return res.status(500).json({
    error: 'Error interno del servidor',
    requestId,
  });
};

module.exports = { errorHandler };
