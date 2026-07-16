/**
 * Structured logger using pino.
 * JSON in production, pretty in development.
 */
const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';
// pino-pretty runs in a worker thread. That is what we want for a dev server
// and exactly what we don't want under the test runner, where the worker
// outlives the run and keeps the process alive.
const isTest = process.env.NODE_ENV === 'test';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProduction || isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } } }
  ),
});

module.exports = { logger };
