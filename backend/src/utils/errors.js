/**
 * AppError — operational errors with known HTTP status codes.
 * These are "expected" errors (bad input, not found, etc.)
 * and are safe to show to the client.
 */
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { AppError };
