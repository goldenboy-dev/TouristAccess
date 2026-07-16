/**
 * Persisted audit trail.
 *
 * Every critical action (ticket emission, validation, cancellation, and all
 * auth events) is written to the AuditLog table AND to the structured logger.
 * stdout/pino alone is not enough: logs rotate away and are not queryable when
 * an operator disputes an entry months later.
 *
 * Writes are best-effort — an audit failure must never break the business
 * operation the user requested, but it is logged at error level so the gap is
 * visible.
 */
const prisma = require('./prisma');
const { logger } = require('./logger');

const AUDIT_EVENTS = {
  TICKET_CREATED: 'ticket.created',
  TICKET_VALIDATED: 'ticket.validated',
  TICKET_VALIDATION_REJECTED: 'ticket.validation_rejected',
  TICKET_CANCELLED: 'ticket.cancelled',
  AUTH_LOGIN_SUCCESS: 'auth.login.success',
  AUTH_LOGIN_FAILED: 'auth.login.failed',
  AUTH_LOGIN_LOCKED: 'auth.login.locked',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_REGISTER: 'auth.register',
  AUTH_PASSWORD_CHANGED: 'auth.password_changed',
  AUTH_SESSIONS_REVOKED_SELF: 'auth.sessions_revoked.self',
  AUTH_SESSIONS_REVOKED_ADMIN: 'auth.sessions_revoked.admin',
  USER_NAME_UPDATED: 'user.name_updated',
};

/**
 * Extract actor + request context from an Express request.
 * Works for unauthenticated requests too (actor fields stay null).
 */
function contextFromRequest(req, overrides = {}) {
  return {
    actor_id: req.user?.id ?? null,
    actor_email: req.user?.email ?? null,
    actor_role: req.user?.role ?? null,
    ip_address: req.ip ?? null,
    user_agent: req.headers?.['user-agent']?.slice(0, 255) ?? null,
    request_id: req.requestId ?? null,
    ...overrides,
  };
}

/**
 * Write one audit entry. Never throws.
 *
 * @param {object} entry
 * @param {string} entry.event         - one of AUDIT_EVENTS
 * @param {string} [entry.outcome]     - SUCCESS | FAILURE (default SUCCESS)
 * @param {string} [entry.resource_type]
 * @param {string|number} [entry.resource_id]
 * @param {object} [entry.metadata]    - extra context, JSON-encoded on write
 */
async function writeAudit(entry) {
  const {
    event,
    outcome = 'SUCCESS',
    actor_id = null,
    actor_email = null,
    actor_role = null,
    resource_type = null,
    resource_id = null,
    ip_address = null,
    user_agent = null,
    request_id = null,
    metadata = null,
  } = entry;

  // Mirror to stdout so live tailing still works.
  logger.info({ event, outcome, actorId: actor_id, resourceType: resource_type, resourceId: resource_id, ip: ip_address, requestId: request_id, ...metadata });

  try {
    await prisma.auditLog.create({
      data: {
        event,
        outcome,
        actor_id,
        actor_email,
        actor_role,
        resource_type,
        resource_id: resource_id != null ? String(resource_id) : null,
        ip_address,
        user_agent,
        request_id,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (error) {
    // Audit persistence failing is itself a security-relevant event.
    logger.error({
      event: 'audit.write_failed',
      originalEvent: event,
      error: error.message,
      requestId: request_id,
    });
  }
}

/** Convenience: build context from req and write in one call. */
async function auditFromRequest(req, entry) {
  return writeAudit({ ...contextFromRequest(req), ...entry });
}

module.exports = { writeAudit, auditFromRequest, contextFromRequest, AUDIT_EVENTS };
