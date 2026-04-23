const { z } = require('zod');

const loginSchema = z.object({
  email:    z.string().email('Email inválido').max(100),
  password: z.string().min(6, 'Contraseña debe tener al menos 6 caracteres').max(100),
});

const registerSchema = z.object({
  name:     z.string().min(2, 'Nombre debe tener al menos 2 caracteres').max(100),
  email:    z.string().email('Email inválido').max(100),
  password: z.string().min(6, 'Contraseña debe tener al menos 6 caracteres').max(100),
  role:     z.enum(['CASHIER', 'GUARD', 'ADMIN'], { errorMap: () => ({ message: 'Rol no válido. Valores permitidos: CASHIER, GUARD, ADMIN' }) }),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token requerido'),
});

module.exports = { loginSchema, registerSchema, refreshSchema };
