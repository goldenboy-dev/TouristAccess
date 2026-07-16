const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');
const { PASSWORD_CHANGE_SCOPE } = require('../utils/password');

/**
 * Verifies the bearer token and populates req.user.
 *
 * @param {object} [options]
 * @param {boolean} [options.allowPasswordChangeScope=false] - when false (the
 *   default) a token scoped to the password-change flow is rejected. Only
 *   /auth/change-password opts in, so an expired-password user cannot use their
 *   restricted token to sell tickets or read the fraud panel.
 */
const verifyToken = ({ allowPasswordChangeScope = false } = {}) => (req, res, next) => {
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

    if (user.scope === PASSWORD_CHANGE_SCOPE && !allowPasswordChangeScope) {
      logger.warn({
        event: 'auth.token.scope_denied',
        userId: user.id,
        scope: user.scope,
        path: req.path,
        ip: req.ip,
        requestId: req.requestId,
      });
      return res.status(403).json({
        message: 'Debés cambiar tu contraseña antes de continuar',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    req.user = user;
    next();
  });
};

const authenticateToken = verifyToken();
const authenticatePasswordChange = verifyToken({ allowPasswordChangeScope: true });

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

module.exports = { authenticateToken, authenticatePasswordChange, authorizeRoles };
