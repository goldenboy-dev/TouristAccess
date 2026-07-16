/**
 * Password policy: composition rules, expiration and brute-force lockout config.
 * Single source of truth — validators, seed and auth controller all read from here.
 */

// JWT scope claim for the restricted token issued when a password must be
// rotated. A token carrying this scope may ONLY reach /auth/change-password.
const PASSWORD_CHANGE_SCOPE = 'password_change';

const MIN_LENGTH = parseInt(process.env.PASSWORD_MIN_LENGTH) || 10;
const MAX_LENGTH = 100; // bcrypt truncates at 72 bytes; the cap also bounds hash cost

// 0 disables expiration (useful for dev / small deployments)
const MAX_AGE_DAYS = parseInt(process.env.PASSWORD_MAX_AGE_DAYS ?? '90');

const MAX_FAILED_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS) || 5;
const LOCKOUT_MINUTES = parseInt(process.env.LOGIN_LOCKOUT_MINUTES) || 15;

// Passwords that are common enough that composition rules alone would let them
// through (e.g. "Password1!"). Compared case-insensitively.
const BLOCKLIST = [
  'password', 'password1', 'password123', 'contraseña', 'contrasena',
  'admin123', 'cajero123', 'guardia123', 'administrador',
  'qwerty', 'qwerty123', '123456', '12345678', '123456789', 'abc123',
  'iloveyou', 'welcome', 'letmein', 'monkey', 'dragon',
  'tourist', 'touristaccess', 'yaguaron', 'cerroyaguaron', 'paraguay',
];

const RULES = [
  { test: (p) => p.length >= MIN_LENGTH, message: `Debe tener al menos ${MIN_LENGTH} caracteres` },
  { test: (p) => p.length <= MAX_LENGTH, message: `No puede superar ${MAX_LENGTH} caracteres` },
  { test: (p) => /[a-z]/.test(p), message: 'Debe incluir al menos una letra minúscula' },
  { test: (p) => /[A-Z]/.test(p), message: 'Debe incluir al menos una letra mayúscula' },
  { test: (p) => /[0-9]/.test(p), message: 'Debe incluir al menos un número' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), message: 'Debe incluir al menos un símbolo (ej: !@#$%)' },
  { test: (p) => !/\s/.test(p), message: 'No puede contener espacios' },
  {
    test: (p) => {
      const normalized = p.toLowerCase().replace(/[^a-z0-9ñ]/g, '');
      return !BLOCKLIST.some((blocked) => normalized === blocked || normalized.includes(blocked));
    },
    message: 'Es una contraseña demasiado común o predecible',
  },
];

/**
 * @returns {string[]} list of violated rule messages (empty === valid)
 */
function getPasswordErrors(password) {
  if (typeof password !== 'string') return ['Contraseña requerida'];
  return RULES.filter((r) => !r.test(password)).map((r) => r.message);
}

function isPasswordValid(password) {
  return getPasswordErrors(password).length === 0;
}

/** True when the password is older than the configured max age. */
function isPasswordExpired(passwordChangedAt) {
  if (MAX_AGE_DAYS <= 0 || !passwordChangedAt) return false;
  const ageMs = Date.now() - new Date(passwordChangedAt).getTime();
  return ageMs > MAX_AGE_DAYS * 86400000;
}

/** Generates a random password that satisfies the policy (used by the seed). */
function generateCompliantPassword() {
  const crypto = require('crypto');
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = lower + upper + digits + symbols;

  const pick = (charset) => charset[crypto.randomInt(charset.length)];

  // Guarantee one of each class, then fill to length with the full charset.
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (chars.length < Math.max(MIN_LENGTH, 16)) chars.push(pick(all));

  // Fisher-Yates with a CSPRNG so class positions aren't predictable.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  const password = chars.join('');
  return isPasswordValid(password) ? password : generateCompliantPassword();
}

module.exports = {
  PASSWORD_CHANGE_SCOPE,
  MIN_LENGTH,
  MAX_LENGTH,
  MAX_AGE_DAYS,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
  getPasswordErrors,
  isPasswordValid,
  isPasswordExpired,
  generateCompliantPassword,
};
