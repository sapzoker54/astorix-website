'use strict';
require('dotenv').config();
require('express-async-errors');

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const compression = require('compression');
const morgan     = require('morgan');
const { logger } = require('./utils/logger');

const authRoutes     = require('./routes/auth');
const civicopsRoutes = require('./routes/civicops');
const { publicLimiter } = require('./middleware/rateLimiter');
const { healthCheck: dbHealth } = require('./config/database');

const app = express();

// ============================================================
// SECURITY HEADERS (Helmet)
// OWASP compliant — required for City of LA contracts
// ============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.weather.gov", "https://earthquake.usgs.gov", "https://data.lacity.org"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ============================================================
// CORS
// Production: only allow app.astorix.ai and astorix.ai
// ============================================================
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:5500');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked origin', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Tier'],
  credentials: true,
  maxAge: 86400,
}));

// ============================================================
// CORE MIDDLEWARE
// ============================================================
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Trust Azure Application Gateway proxy
app.set('trust proxy', 1);

// Request logging — use JSON in production
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.path === '/health',  // Don't log health checks
}));

// Request ID for distributed tracing
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || require('uuid').v4();
  res.set('X-Request-ID', req.requestId);
  next();
});

// ============================================================
// HEALTH ENDPOINTS (no auth — Azure health checks)
// ============================================================
app.get('/health', async (req, res) => {
  try {
    const db = await dbHealth();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: process.env.APP_VERSION || '1.0.0', db });
  } catch (err) {
    logger.error('Health check failed', { error: err.message });
    res.status(503).json({ status: 'error', error: err.message });
  }
});

app.get('/health/ready', async (req, res) => {
  res.json({ ready: true });
});

// ============================================================
// ROUTES
// ============================================================
app.use('/api/auth',     publicLimiter, authRoutes);
app.use('/api/civicops', civicopsRoutes);

// CCPA — Data Subject Rights (no auth — requestor may not have account)
app.post('/api/privacy/ccpa-request', publicLimiter, async (req, res) => {
  const { email, request_type, notes } = req.body;
  if (!email || !request_type) return res.status(400).json({ error: 'email and request_type required' });
  if (!['delete', 'export', 'opt_out_sale'].includes(request_type)) return res.status(400).json({ error: 'Invalid request_type' });

  const { query } = require('./config/database');
  await query(
    'INSERT INTO ccpa_deletion_requests (requestor_email, request_type, notes) VALUES ($1, $2, $3)',
    [email.toLowerCase().trim(), request_type, notes || null]
  );

  logger.info('CCPA request received', { email, request_type, ip: req.ip });
  res.json({ message: 'Your request has been received and will be processed within 45 days per CCPA §1798.105.', request_type });
});

// ============================================================
// ERROR HANDLING
// ============================================================
// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found`, code: 'NOT_FOUND' });
});

// Global error handler
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  logger.error('Unhandled error', {
    error: err.message, stack: err.stack,
    path: req.path, method: req.method, requestId: req.requestId,
  });

  // Don't expose internal errors in production
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'An internal error occurred. Our team has been notified.'
    : err.message;

  res.status(status).json({ error: message, code: err.code || 'INTERNAL_ERROR', requestId: req.requestId });
});

module.exports = app;
