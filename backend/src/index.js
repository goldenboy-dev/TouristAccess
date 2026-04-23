require('dotenv').config();

// ─── Fail fast if env is incomplete ─────────────────────────
const { validateEnv } = require('./utils/env');
validateEnv();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { requestId } = require('./middlewares/requestId');
const { errorHandler } = require('./middlewares/errorHandler');
const { logger } = require('./utils/logger');

const authRoutes = require('./routes/auth.routes');
const ticketRoutes = require('./routes/ticket.routes');
const dashboardRoutes = require('./routes/dashboard.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security headers (helmet) ──────────────────────────────
app.use(helmet({
  frameguard: { action: 'deny' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  noSniff: true,
  referrerPolicy: { policy: 'no-referrer' },
}));

// ─── CORS (restricted origins from .env) ────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn({ event: 'cors.blocked', origin, allowedOrigins });
      callback(new Error('Origen no permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body parsing (with size limit) ─────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Request ID for traceability ────────────────────────────
app.use(requestId);

// ─── Routes ─────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/dashboard', dashboardRoutes);

// ─── Health check ───────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Backend is running' });
});

// ─── Centralized error handler (MUST be last) ───────────────
app.use(errorHandler);

// ─── Start server ───────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  logger.info({ event: 'server.start', port: PORT, origins: allowedOrigins });
});
