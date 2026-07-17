const { z } = require('zod');
const { getPasswordErrors, MAX_LENGTH } = require('../utils/password');
const { ROLES } = require('../constants/user');

// Strong password rules live in utils/password.js so the seed, the validator
// and the controller cannot drift apart.
const strongPassword = z.string().superRefine((value, ctx) => {
  for (const message of getPasswordErrors(value)) {
    ctx.addIssue({ code: 'custom', message });
  }
});

// Login must NOT apply the new policy: accounts created before it exists still
// have shorter passwords and have to be able to log in (and then be forced to
// rotate). Only length bounds are enforced here.
const loginSchema = z.object({
  email:    z.string().email('Email inválido').max(100),
  password: z.string().min(1, 'Contraseña requerida').max(MAX_LENGTH),
});

const registerSchema = z.object({
  name:     z.string().min(2, 'Nombre debe tener al menos 2 caracteres').max(100),
  email:    z.string().email('Email inválido').max(100),
  password: strongPassword,
  // Zod 4 replaced `errorMap` with `error`; the old form was silently ignored.
  role:     z.enum(ROLES, { error: () => `Rol no válido. Valores permitidos: ${ROLES.join(', ')}` }),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token requerido'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contraseña actual requerida').max(MAX_LENGTH),
  newPassword:     strongPassword,
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'La nueva contraseña debe ser distinta de la actual',
  path: ['newPassword'],
});

module.exports = { loginSchema, registerSchema, refreshSchema, changePasswordSchema };
