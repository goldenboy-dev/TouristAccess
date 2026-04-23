/**
 * Request ID middleware — assigns a UUID v4 to every request
 * for end-to-end traceability in logs.
 */
const { v4: uuidv4 } = require('uuid');

const requestId = (req, res, next) => {
  req.requestId = uuidv4();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

module.exports = { requestId };
