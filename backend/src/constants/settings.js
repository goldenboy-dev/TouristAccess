/**
 * Operating-settings constants — single source of truth shared by
 * settings.service.js and its validator, same split as constants/ticket.js.
 *
 * Dependency-free on purpose: the validator layer must be able to import this
 * without pulling in Prisma.
 */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

module.exports = { TIME_RE };
