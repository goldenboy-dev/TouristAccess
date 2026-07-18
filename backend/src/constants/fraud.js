/**
 * Fraud-alert domain constants — mirrors constants/ticket.js: dependency-free
 * so the validator layer can import it without pulling in Prisma.
 */
const ALERT_STATUSES = ['PENDIENTE', 'REVISADA', 'DESESTIMADA', 'ESCALADA'];
const ALERT_LEVELS = ['CRITICO', 'AVISO'];

module.exports = { ALERT_STATUSES, ALERT_LEVELS };
