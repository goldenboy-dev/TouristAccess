const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ message: 'Token de autenticación requerido' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      // Distinguish between expired and invalid for the frontend to know when to refresh
      const isExpired = err.name === 'TokenExpiredError';
      logger.warn({
        event: 'auth.token.invalid',
        reason: isExpired ? 'expired' : 'invalid',
        ip: req.ip,
        path: req.path,
        requestId: req.requestId,
      });
      return res.status(401).json({
        message: isExpired ? 'Token expirado' : 'Token inválido',
        code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      });
    }
    req.user = user;
    next();
  });
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      logger.warn({
        event: 'auth.access_denied',
        userId: req.user?.id,
        role: req.user?.role,
        requiredRoles: roles,
        path: req.path,
        method: req.method,
        ip: req.ip,
        requestId: req.requestId,
      });
      return res.status(403).json({ message: 'No autorizado para esta acción' });
    }
    next();
  };
};

module.exports = { authenticateToken, authorizeRoles };
