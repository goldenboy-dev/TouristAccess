/**
 * AppError — operational errors with known HTTP status codes.
 * These are "expected" errors (bad input, not found, etc.)
 * and are safe to show to the client.
 *
 * `code` is a stable machine-readable string the frontend can branch on
 * (TOKEN_EXPIRED, ACCOUNT_LOCKED, ...); `details` carries extra fields that
 * the error handler merges into the JSON body (retryAfterMinutes, errors, ...).
 */
class AppError extends Error {
  constructor(message, statusCode = 400, { code = null, details = null } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Factories for the statuses this API actually returns. Using them keeps the
// status code out of the call site, where a typo silently changes semantics.
const badRequest   = (message, options)               => new AppError(message, 400, options);
const unauthorized = (message = 'No autorizado', options)   => new AppError(message, 401, options);
const forbidden    = (message = 'Acceso denegado', options) => new AppError(message, 403, options);
const notFound     = (message = 'Recurso no encontrado', options) => new AppError(message, 404, options);
const locked       = (message, options)               => new AppError(message, 423, options);
const serviceUnavailable = (message, options)          => new AppError(message, 503, options);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, locked, serviceUnavailable };
