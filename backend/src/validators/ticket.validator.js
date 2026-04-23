const { z } = require('zod');

const createTicketSchema = z.object({
  customer_name:     z.string().max(100, 'Nombre no puede superar 100 caracteres').optional(),
  number_of_adults:  z.coerce.number().int().min(0).max(50).default(0),
  number_of_children: z.coerce.number().int().min(0).max(50).default(0),
  number_of_locals:  z.coerce.number().int().min(0).max(50).default(0),
  children_cedulas:  z.array(z.string().max(20)).optional().default([]),
  locals_cedulas:    z.array(z.string().max(20)).default([]),
  payment_method:    z.enum(['CASH', 'CARD', 'TRANSFER', 'QR'], {
    errorMap: () => ({ message: 'Método de pago debe ser CASH, CARD, TRANSFER o QR' })
  }),
  visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)'),
}).refine(
  data => (data.number_of_adults + data.number_of_children + data.number_of_locals) >= 1,
  { message: 'Debe haber al menos una persona' }
).refine(
  data => (data.number_of_adults + data.number_of_children + data.number_of_locals) <= 50,
  { message: 'Máximo 50 personas por operación' }
).refine(
  data => data.locals_cedulas.length === data.number_of_locals,
  { message: 'Cada residente local requiere número de cédula' }
);

const validateTicketSchema = z.object({
  token:          z.string().min(10, 'Token inválido').max(200),
  free_confirmed: z.boolean().optional(),
});

module.exports = { createTicketSchema, validateTicketSchema };
