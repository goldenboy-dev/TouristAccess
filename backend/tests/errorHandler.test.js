import { describe, it, expect, vi, beforeEach } from 'vitest';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { AppError, badRequest, notFound, locked } from '../src/utils/errors.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const req = { requestId: 'req-1', ip: '10.0.0.1', method: 'POST', path: '/api/tickets' };

let res;
beforeEach(() => { res = mockRes(); });

describe('AppError', () => {
  it('marks itself operational with the given status', () => {
    const err = new AppError('boom', 418);
    expect(err.statusCode).toBe(418);
    expect(err.isOperational).toBe(true);
  });

  it('defaults to 400', () => {
    expect(new AppError('boom').statusCode).toBe(400);
  });

  it('carries a code and details through the factories', () => {
    const err = locked('bloqueado', { code: 'ACCOUNT_LOCKED', details: { retryAfterMinutes: 15 } });
    expect(err.statusCode).toBe(423);
    expect(err.code).toBe('ACCOUNT_LOCKED');
    expect(err.details).toEqual({ retryAfterMinutes: 15 });
  });
});

describe('errorHandler', () => {
  it('answers an operational error with its own status and message', () => {
    errorHandler(notFound('Ticket no encontrado'), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Ticket no encontrado',
      // Both keys: the SPA reads `data.error || data.message`, and older
      // callers only ever read `message`.
      message: 'Ticket no encontrado',
      requestId: 'req-1',
    }));
  });

  it('merges code and details into the body', () => {
    errorHandler(
      locked('Cuenta bloqueada', { code: 'ACCOUNT_LOCKED', details: { retryAfterMinutes: 15 } }),
      req, res, vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ACCOUNT_LOCKED',
      retryAfterMinutes: 15,
    }));
  });

  it('keeps details from overwriting the canonical fields', () => {
    errorHandler(
      badRequest('mensaje real', { details: { error: 'sobrescrito', message: 'sobrescrito' } }),
      req, res, vi.fn(),
    );

    const body = res.json.mock.calls[0][0];
    expect(body.error).toBe('mensaje real');
    expect(body.message).toBe('mensaje real');
  });

  it('never leaks an unexpected error to the client', () => {
    const err = new Error('column "secret_column" does not exist');
    err.stack = 'at prisma...';

    errorHandler(err, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({
      error: 'Error interno del servidor',
      message: 'Error interno del servidor',
      requestId: 'req-1',
    });
    expect(JSON.stringify(body)).not.toMatch(/secret_column|prisma/);
  });

  it('answers a blocked CORS origin with a 403', () => {
    errorHandler(new Error('Origen no permitido por CORS'), req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('falls back to "unknown" when the request has no id', () => {
    errorHandler(badRequest('x'), { ...req, requestId: undefined }, res, vi.fn());
    expect(res.json.mock.calls[0][0].requestId).toBe('unknown');
  });
});
