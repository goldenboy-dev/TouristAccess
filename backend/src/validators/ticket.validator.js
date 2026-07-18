const { z } = require('zod');
const { optionalDate, optionalId, boundedInt, optionalEnum } = require('./query');
const { DATE_RE, parseLocalDate, startOfToday, localDaysBetween } = require('../utils/date');
const {
  VISITOR_TYPES, PAYMENT_METHODS, TICKET_STATUSES, MAX_PERSONS, MAX_VISIT_DATE_DRIFT_DAYS,
} = require('../constants/ticket');

const totalPersons = (d) => d.number_of_adults + d.number_of_children + d.number_of_locals;

const createTicketSchema = z.object({
  customer_name: z.string()
    .max(100, 'Nombre no puede superar 100 caracteres')
    // The name is interpolated into the printable ticket; it is escaped there
    // too, but there is no legitimate reason for markup in a customer name.
    .refine((v) => !/<[^>]*>/.test(v), 'El nombre del cliente no puede contener HTML')
    .optional(),
  number_of_adults:   z.coerce.number().int().min(0).max(MAX_PERSONS).default(0),
  number_of_children: z.coerce.number().int().min(0).max(MAX_PERSONS).default(0),
  number_of_locals:   z.coerce.number().int().min(0).max(MAX_PERSONS).default(0),
  children_cedulas:   z.array(z.string().max(20)).optional().default([]),
  // A free LOCAL entry without a cédula is unauditable — this is the rule the
  // whole anti-fraud panel leans on.
  locals_cedulas: z.array(z.string().min(1, 'La cédula no puede estar vacía').max(20)).default([]),
  payment_method: z.enum(PAYMENT_METHODS, {
    // Zod 4 renamed `errorMap` to `error`; the old key was silently ignored,
    // so this message never reached the user.
    error: 'Método de pago debe ser CASH, CARD, TRANSFER o QR',
  }),
  visit_date: z.string()
    .regex(DATE_RE, 'Formato de fecha inválido (YYYY-MM-DD)')
    .refine((v) => parseLocalDate(v) !== null, 'La fecha de visita no existe en el calendario'),
})
  .refine((d) => totalPersons(d) >= 1, { message: 'Debe haber al menos una persona' })
  .refine((d) => totalPersons(d) <= MAX_PERSONS, { message: `Máximo ${MAX_PERSONS} personas por operación` })
  .refine((d) => d.locals_cedulas.length === d.number_of_locals, {
    message: 'Cada residente local requiere número de cédula',
    path: ['locals_cedulas'],
  })
  // Compared as calendar days in local time: a UTC-parsed date is a day off
  // west of Greenwich, which would make "today" land outside the window.
  .refine((d) => {
    const visit = parseLocalDate(d.visit_date);
    if (!visit) return false;
    return Math.abs(localDaysBetween(startOfToday(), visit)) <= MAX_VISIT_DATE_DRIFT_DAYS;
  }, {
    message: `visit_date no puede ser más de ${MAX_VISIT_DATE_DRIFT_DAYS} días en el pasado o futuro`,
    path: ['visit_date'],
  });

const validateTicketSchema = z.object({
  token:          z.string().min(10, 'Token inválido').max(200),
  free_confirmed: z.boolean().optional(),
});

const cancelTicketSchema = z.object({
  reason: z.string()
    .trim()
    .min(5, 'El motivo de la anulación debe tener al menos 5 caracteres')
    .max(500, 'El motivo no puede superar 500 caracteres')
    .refine((v) => !/<[^>]*>/.test(v), 'El motivo no puede contener HTML'),
});

const listTicketsQuerySchema = z.object({
  status:         optionalEnum(TICKET_STATUSES, 'status debe ser ACTIVE, USED o CANCELLED'),
  visitor_type:   optionalEnum(VISITOR_TYPES, 'visitor_type debe ser ADULT, CHILD o LOCAL'),
  payment_method: optionalEnum(PAYMENT_METHODS, 'payment_method debe ser CASH, CARD, TRANSFER o QR'),
  date:           optionalDate('date'),
  date_from:      optionalDate('date_from'),
  date_to:        optionalDate('date_to'),
  // Solo tiene efecto para ADMIN — un CASHIER ya está limitado a sus propias
  // ventas en el servicio, sin importar qué mande acá (ver listTickets()).
  cajero_id:      optionalId('cajero_id'),
  page:  boundedInt({ min: 1, max: 100000, fallback: 1,  label: 'page' }),
  limit: boundedInt({ min: 1, max: 200,    fallback: 50, label: 'limit' }),
});

module.exports = {
  createTicketSchema,
  validateTicketSchema,
  cancelTicketSchema,
  listTicketsQuerySchema,
  MAX_PERSONS,
  MAX_VISIT_DATE_DRIFT_DAYS,
};
