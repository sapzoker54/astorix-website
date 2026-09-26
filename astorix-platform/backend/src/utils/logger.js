'use strict';
const winston = require('winston');

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: {
    service: 'astorix-api',
    environment: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0',
  },
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'development' ? combine(colorize(), simple()) : combine(timestamp(), json()),
    }),
  ],
});

// Structured audit log — separate stream for compliance
const auditLogger = winston.createLogger({
  level: 'info',
  format: combine(timestamp(), json()),
  defaultMeta: { service: 'astorix-audit' },
  transports: [
    new winston.transports.Console(),
    // In production: add Azure Log Analytics or Application Insights transport
  ],
});

module.exports = { logger, auditLogger };
