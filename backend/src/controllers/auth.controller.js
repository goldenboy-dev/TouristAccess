const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { logger } = require('../utils/logger');

// ─── Helper: hash a refresh token with SHA-256 ──────────────
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Helper: generate a cryptographically random refresh token ──
function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

// ─── Helper: create access token (short-lived, 15min) ───────
function createAccessToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
  );
}

// ─── Helper: parse JWT_REFRESH_EXPIRY to milliseconds ───────
function getRefreshExpiryMs() {
  const raw = process.env.JWT_REFRESH_EXPIRY || '7d';
  const match = raw.match(/^(\d+)([dhms])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
  const [, num, unit] = match;
  const multipliers = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  return parseInt(num) * (multipliers[unit] || 86400000);
}

// ─── LOGIN ──────────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body; // already validated by Zod middleware

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      logger.warn({ event: 'auth.login.failed', email, ip: req.ip, reason: 'user_not_found', requestId: req.requestId });
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      logger.warn({ event: 'auth.login.failed', email, ip: req.ip, reason: 'wrong_password', requestId: req.requestId });
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Generate access token (short-lived)
    const accessToken = createAccessToken(user);

    // Generate refresh token (long-lived, stored hashed in DB)
    const rawRefreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + getRefreshExpiryMs());

    await prisma.refreshToken.create({
      data: {
        token_hash: refreshTokenHash,
        user_id: user.id,
        ip_address: req.ip,
        expires_at: expiresAt,
      }
    });

    logger.info({ event: 'auth.login.success', userId: user.id, role: user.role, ip: req.ip, requestId: req.requestId });

    res.status(200).json({
      accessToken,
      refreshToken: rawRefreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    next(error);
  }
};

// ─── REGISTER ───────────────────────────────────────────────
const register = async (req, res, next) => {
  try {
    const { email, password, role, name } = req.body; // validated by Zod

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: 'El usuario ya existe' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = await prisma.user.create({
      data: { email, name, password: hashedPassword, role }
    });

    logger.info({
      event: 'auth.register', userId: newUser.id, role: newUser.role,
      createdBy: req.user.id, ip: req.ip, requestId: req.requestId,
    });

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
    });
  } catch (error) {
    next(error);
  }
};

// ─── REFRESH ────────────────────────────────────────────────
// Receives a refresh token, validates it, rotates it (old one is revoked,
// new pair is issued). This prevents replay attacks.
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body; // validated by Zod

    const tokenHash = hashToken(refreshToken);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token_hash: tokenHash },
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    });

    if (!storedToken || storedToken.revoked) {
      logger.warn({ event: 'auth.refresh.invalid', ip: req.ip, reason: storedToken?.revoked ? 'revoked' : 'not_found', requestId: req.requestId });
      return res.status(401).json({ message: 'Token de sesión inválido' });
    }

    if (storedToken.expires_at < new Date()) {
      logger.warn({ event: 'auth.refresh.expired', userId: storedToken.user_id, ip: req.ip, requestId: req.requestId });
      return res.status(401).json({ message: 'Sesión expirada. Iniciá sesión de nuevo.' });
    }

    // Security event: IP changed since original login
    if (storedToken.ip_address && storedToken.ip_address !== req.ip) {
      logger.warn({
        event: 'auth.refresh.ip_change',
        userId: storedToken.user_id,
        originalIp: storedToken.ip_address,
        currentIp: req.ip,
        requestId: req.requestId,
      });
    }

    // Rotate: revoke old token, issue new pair
    const newRawRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + getRefreshExpiryMs());

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revoked: true },
      }),
      prisma.refreshToken.create({
        data: {
          token_hash: newRefreshTokenHash,
          user_id: storedToken.user_id,
          ip_address: req.ip,
          expires_at: newExpiresAt,
        },
      }),
    ]);

    const accessToken = createAccessToken(storedToken.user);

    logger.info({ event: 'auth.refresh.success', userId: storedToken.user_id, ip: req.ip, requestId: req.requestId });

    res.status(200).json({
      accessToken,
      refreshToken: newRawRefreshToken,
      user: storedToken.user,
    });
  } catch (error) {
    next(error);
  }
};

// ─── LOGOUT ─────────────────────────────────────────────────
// Revokes the refresh token in the DB. Critical for shared devices
// (guards pass phones between shifts).
const logoutHandler = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      // Revoke this specific token (ignore if not found)
      await prisma.refreshToken.updateMany({
        where: { token_hash: tokenHash, revoked: false },
        data: { revoked: true },
      });
    }

    logger.info({ event: 'auth.logout', userId: req.user?.id, ip: req.ip, requestId: req.requestId });

    res.status(200).json({ message: 'Sesión cerrada' });
  } catch (error) {
    next(error);
  }
};

// ─── REVOKE ALL (admin can invalidate all tokens for a user) ──
const revokeAllTokens = async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId);

    const result = await prisma.refreshToken.updateMany({
      where: { user_id: userId, revoked: false },
      data: { revoked: true },
    });

    logger.warn({
      event: 'auth.revoke_all', targetUserId: userId,
      revokedCount: result.count, adminId: req.user.id, ip: req.ip, requestId: req.requestId,
    });

    res.status(200).json({ message: `${result.count} tokens revocados`, count: result.count });
  } catch (error) {
    next(error);
  }
};

module.exports = { login, register, refresh, logoutHandler, revokeAllTokens };
