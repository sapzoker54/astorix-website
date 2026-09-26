'use strict';
const { Pool } = require('pg');
const { logger } = require('../utils/logger');

// Connection pool — sized for Azure PostgreSQL Flexible Server
// Handles millions of requests via connection pooling
const pool = new Pool({
  host:               process.env.DB_HOST,
  port:               parseInt(process.env.DB_PORT || '5432'),
  database:           process.env.DB_NAME,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  max:                parseInt(process.env.DB_POOL_MAX || '20'),       // max connections
  min:                parseInt(process.env.DB_POOL_MIN || '2'),        // min idle connections
  idleTimeoutMillis:  parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '5000'),
  statement_timeout:  parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000'),
});

pool.on('error', (err, client) => {
  logger.error('PostgreSQL pool error', { error: err.message, stack: err.stack });
});

pool.on('connect', () => {
  logger.debug('New PostgreSQL client connected');
});

/**
 * Execute a query with automatic client release
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters (prevents SQL injection)
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow query detected', { duration, query: text.substring(0, 100) });
    }
    return result;
  } catch (err) {
    logger.error('Database query error', { error: err.message, query: text.substring(0, 100) });
    throw err;
  }
};

/**
 * Get a client for transactions
 * Always use try/finally to release the client
 */
const getClient = () => pool.connect();

/**
 * Execute within a transaction
 * Automatically commits on success, rolls back on error
 */
const transaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Health check — called by /health endpoint
 */
const healthCheck = async () => {
  const result = await query('SELECT 1 AS ok, NOW() AS server_time');
  return { ok: true, server_time: result.rows[0].server_time, pool_total: pool.totalCount, pool_idle: pool.idleCount, pool_waiting: pool.waitingCount };
};

module.exports = { query, getClient, transaction, healthCheck };
