/**
 * Ticket domain constants — the single source of truth.
 *
 * These were declared twice (service + validator) with the lists in different
 * orders: changing a limit meant remembering both, and nothing would have
 * failed if they drifted apart.
 *
 * Deliberately dependency-free: the validator layer must be able to import
 * this without pulling in Prisma.
 */
const VISITOR_TYPES = ['ADULT', 'CHILD', 'LOCAL'];
const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'QR'];
const TICKET_STATUSES = ['ACTIVE', 'USED', 'CANCELLED'];

// Free entries: the fraud panel exists because these are the abusable ones.
const FREE_VISITOR_TYPES = ['CHILD', 'LOCAL'];
// Statuses that count as a real sale (a cancelled ticket is not revenue).
const COUNTED_STATUSES = ['ACTIVE', 'USED'];

const MAX_PERSONS = 50;
const MAX_VISIT_DATE_DRIFT_DAYS = 7;

module.exports = {
  VISITOR_TYPES,
  PAYMENT_METHODS,
  TICKET_STATUSES,
  FREE_VISITOR_TYPES,
  COUNTED_STATUSES,
  MAX_PERSONS,
  MAX_VISIT_DATE_DRIFT_DAYS,
};
