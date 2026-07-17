/**
 * User domain constants. Same reasoning as constants/ticket.js: the role
 * enum used to live only inline in auth.validator.js and would have been
 * duplicated a second time by the role-update validator.
 */
const ROLES = ['ADMIN', 'CASHIER', 'GUARD'];

module.exports = { ROLES };
