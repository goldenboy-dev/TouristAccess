const crypto = require('crypto');

/**
 * Generates a random secure token using crypto.
 * @param {number} length The byte length of the token
 * @returns {string} The hex representation of the token
 */
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

module.exports = {
  generateSecureToken,
};
