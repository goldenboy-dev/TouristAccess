const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { logger } = require('../utils/logger');
const { auditFromRequest, AUDIT_EVENTS } = require('../utils/audit');
const {
  PASSWORD_CHANGE_SCOPE,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
  getPasswordErrors,
  isPasswordExpired,
} = require('../utils/password');

// Pre-computed hash of a dummy password. Compared against when the email does
// not exist so that login latency does not reveal whether an account is real.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-equalization', 12);

// ─── Helper: hash a refresh token with SHA-256 ──────────────
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Helper: generate a cryptographically random refresh token ──
function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

// ─── Helper: create access token (short-lived, 15min) ───────
function createAccessToken(user, { scope = null, expiresIn = null } = {}) {
  // `email` is carried so the audit trail can denormalize the actor's identity
  // without an extra query on every write — AuditLog.actor_id is SET NULL on
  // user deletion, so the email column is what keeps old entries attributable.
  const payload = { id: user.id, email: user.email, role: user.role };
  if (scope) payload.scope = scope;

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: expiresIn || process.env.JWT_ACCESS_EXPIRY || '15m',
  });
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

// ─── Helper: issue an access + refresh token pair ───────────
async function issueSession(user, req) {
  const accessToken = createAccessToken(user);
  const rawRefreshToken = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      token_hash: hashToken(rawRefreshToken),
      user_id: user.id,
      ip_address: req.ip,
      expires_at: new Date(Date.now() + getRefreshExpiryMs()),
    },
  });

  return { accessToken, refreshToken: rawRefreshToken };
}

// ─── Helper: register a failed attempt and lock if over the limit ──
async function registerFailedAttempt(user) {
  const attempts = user.failed_login_attempts + 1;
  const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failed_login_attempts: attempts,
      locked_until: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : user.locked_until,
    },
  });

  return { attempts, locked: shouldLock };
}

// ─── LOGIN ──────────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body; // already validated by Zod middleware

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Burn comparable CPU time so a missing account is not distinguishable
      // from a wrong password by response latency.
      await bcrypt.compare(password, DUMMY_HASH);
      await auditFromRequest(req, {
        event: AUDIT_EVENTS.AUTH_LOGIN_FAILED,
        outcome: 'FAILURE',
        metadata: { email, reason: 'user_not_found' },
      });
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // ── Lockout check (before verifying the password) ──
    if (user.locked_until && user.locked_until > new Date()) {
      const minutesLeft = Math.ceil((user.locked_until - Date.now()) / 60000);
      await auditFromRequest(req, {
        event: AUDIT_EVENTS.AUTH_LOGIN_LOCKED,
        outcome: 'FAILURE',
        actor_id: user.id,
        actor_email: user.email,
        actor_role: user.role,
        metadata: { reason: 'account_locked', minutesLeft },
      });
      return res.status(423).json({
        message: `Cuenta bloqueada por intentos fallidos. Reintentá en ${minutesLeft} minuto(s).`,
        code: 'ACCOUNT_LOCKED',
        retryAfterMinutes: minutesLeft,
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      const { attempts, locked } = await registerFailedAttempt(user);
      await auditFromRequest(req, {
        event: locked ? AUDIT_EVENTS.AUTH_LOGIN_LOCKED : AUDIT_EVENTS.AUTH_LOGIN_FAILED,
        outcome: 'FAILURE',
        actor_id: user.id,
        actor_email: user.email,
        actor_role: user.role,
        metadata: { reason: 'wrong_password', attempts, locked },
      });

      if (locked) {
        return res.status(423).json({
          message: `Cuenta bloqueada por ${LOCKOUT_MINUTES} minutos tras ${MAX_FAILED_ATTEMPTS} intentos fallidos.`,
          code: 'ACCOUNT_LOCKED',
          retryAfterMinutes: LOCKOUT_MINUTES,
        });
      }

      return res.status(401).json({
        message: 'Credenciales inválidas',
        attemptsLeft: Math.max(0, MAX_FAILED_ATTEMPTS - attempts),
      });
    }

    // ── Correct password: clear any accumulated failures ──
    if (user.failed_login_attempts > 0 || user.locked_until) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failed_login_attempts: 0, locked_until: null },
      });
    }

    // ── Password expiration / forced rotation ──
    const expired = isPasswordExpired(user.password_changed_at);
    if (expired || user.must_change_password) {
      // No refresh token here: the only usable credential is a 10-minute
      // token scoped to the change-password endpoint.
      const changeToken = createAccessToken(user, { scope: PASSWORD_CHANGE_SCOPE, expiresIn: '10m' });

      await auditFromRequest(req, {
        event: AUDIT_EVENTS.AUTH_LOGIN_SUCCESS,
        actor_id: user.id,
        actor_email: user.email,
        actor_role: user.role,
        metadata: { passwordChangeRequired: true, reason: expired ? 'password_expired' : 'admin_forced' },
      });

      return res.status(200).json({
        message: expired
          ? 'Tu contraseña expiró. Cambiala para continuar.'
          : 'Debés cambiar tu contraseña para continuar.',
        code: 'PASSWORD_CHANGE_REQUIRED',
        passwordChangeRequired: true,
        passwordChangeToken: changeToken,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
    }

    const { accessToken, refreshToken } = await issueSession(user, req);

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.AUTH_LOGIN_SUCCESS,
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
    });

    res.status(200).json({
      accessToken,
      refreshToken,
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
      data: {
        email,
        name,
        password: hashedPassword,
        role,
        password_changed_at: new Date(),
        // The admin knows this password — the user must set their own on first login.
        must_change_password: true,
      },
    });

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.AUTH_REGISTER,
      resource_type: 'User',
      resource_id: newUser.id,
      metadata: { createdEmail: newUser.email, createdRole: newUser.role },
    });

    res.status(201).json({
      message: 'Usuario creado exitosamente. Deberá cambiar su contraseña en el primer inicio de sesión.',
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
    });
  } catch (error) {
    next(error);
  }
};

// ─── CHANGE PASSWORD ────────────────────────────────────────
// Accepts either a normal session token or the restricted password-change
// token issued when a password is expired / flagged for rotation.
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body; // validated by Zod

    const user = await prisma.user.findUnique({ where: { id: parseInt(req.user.id) } });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      await auditFromRequest(req, {
        event: AUDIT_EVENTS.AUTH_PASSWORD_CHANGED,
        outcome: 'FAILURE',
        actor_email: user.email,
        resource_type: 'User',
        resource_id: user.id,
        metadata: { reason: 'wrong_current_password' },
      });
      return res.status(401).json({ message: 'La contraseña actual es incorrecta' });
    }

    // Policy check (also enforced by Zod; repeated here because this is the
    // last line of defence before a weak hash is persisted).
    const policyErrors = getPasswordErrors(newPassword);
    if (policyErrors.length > 0) {
      return res.status(400).json({ message: 'La contraseña no cumple la política', errors: policyErrors });
    }

    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ message: 'La nueva contraseña debe ser distinta de la actual' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Changing a password invalidates every existing session: if the change was
    // triggered by a suspected compromise, leaving old refresh tokens alive
    // would defeat the purpose.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          password_changed_at: new Date(),
          must_change_password: false,
          failed_login_attempts: 0,
          locked_until: null,
        },
      }),
      prisma.refreshToken.updateMany({
        where: { user_id: user.id, revoked: false },
        data: { revoked: true },
      }),
    ]);

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.AUTH_PASSWORD_CHANGED,
      actor_email: user.email,
      resource_type: 'User',
      resource_id: user.id,
    });

    res.status(200).json({
      message: 'Contraseña actualizada. Iniciá sesión nuevamente.',
      sessionsRevoked: true,
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

    await auditFromRequest(req, { event: AUDIT_EVENTS.AUTH_LOGOUT });

    res.status(200).json({ message: 'Sesión cerrada' });
  } catch (error) {
    next(error);
  }
};

// ─── REVOKE MY SESSIONS (self-service, for a lost/stolen device) ──
// Any authenticated user can kill every session of their own account without
// waiting for an admin — the whole point when a phone goes missing mid-shift.
const revokeMySessions = async (req, res, next) => {
  try {
    const userId = parseInt(req.user.id);

    const result = await prisma.refreshToken.updateMany({
      where: { user_id: userId, revoked: false },
      data: { revoked: true },
    });

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.AUTH_SESSIONS_REVOKED_SELF,
      resource_type: 'User',
      resource_id: userId,
      metadata: { revokedCount: result.count },
    });

    res.status(200).json({
      message: `Se cerraron ${result.count} sesión(es) en todos los dispositivos. Iniciá sesión de nuevo.`,
      count: result.count,
    });
  } catch (error) {
    next(error);
  }
};

// ─── REVOKE ALL (admin can invalidate all tokens for a user) ──
const revokeAllTokens = async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ message: 'userId inválido' });

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!target) return res.status(404).json({ message: 'Usuario no encontrado' });

    const { forcePasswordChange } = req.body || {};

    const operations = [
      prisma.refreshToken.updateMany({
        where: { user_id: userId, revoked: false },
        data: { revoked: true },
      }),
    ];

    // Device lost with a saved password: revoking sessions is not enough if the
    // credential itself may be known — the admin can force a rotation too.
    if (forcePasswordChange === true) {
      operations.push(
        prisma.user.update({ where: { id: userId }, data: { must_change_password: true } })
      );
    }

    const [result] = await prisma.$transaction(operations);

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.AUTH_SESSIONS_REVOKED_ADMIN,
      resource_type: 'User',
      resource_id: userId,
      metadata: {
        targetEmail: target.email,
        revokedCount: result.count,
        forcePasswordChange: forcePasswordChange === true,
      },
    });

    res.status(200).json({
      message: `${result.count} tokens revocados`,
      count: result.count,
      forcePasswordChange: forcePasswordChange === true,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  register,
  refresh,
  logoutHandler,
  revokeAllTokens,
  revokeMySessions,
  changePassword,
};
