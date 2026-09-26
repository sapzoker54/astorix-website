'use strict';
const { createClient } = require('redis');
const { logger } = require('../utils/logger');

let client = null;

const getRedisClient = async () => {
  if (client && client.isReady) return client;

  client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      connectTimeout: 5000,
      lazyConnect: true,
      tls: process.env.REDIS_TLS === 'true',
    },
    password: process.env.REDIS_PASSWORD || undefined,
  });

  client.on('error', (err) => logger.error('Redis error', { error: err.message }));
  client.on('connect', () => logger.info('Redis connected'));
  client.on('reconnecting', () => logger.warn('Redis reconnecting'));

  await client.connect();
  return client;
};

/**
 * Get cached value. Returns null if miss or error.
 */
const cacheGet = async (key) => {
  try {
    const redis = await getRedisClient();
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    logger.warn('Redis GET failed, bypassing cache', { key, error: err.message });
    return null;
  }
};

/**
 * Set cached value with TTL in seconds
 */
const cacheSet = async (key, value, ttlSeconds = 60) => {
  try {
    const redis = await getRedisClient();
    await redis.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    logger.warn('Redis SET failed', { key, error: err.message });
  }
};

/**
 * Delete a key (cache invalidation)
 */
const cacheDel = async (key) => {
  try {
    const redis = await getRedisClient();
    await redis.del(key);
  } catch (err) {
    logger.warn('Redis DEL failed', { key, error: err.message });
  }
};

/**
 * Increment a counter (for rate limiting)
 */
const cacheIncr = async (key, ttlSeconds) => {
  try {
    const redis = await getRedisClient();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, ttlSeconds);
    return count;
  } catch (err) {
    logger.warn('Redis INCR failed', { key, error: err.message });
    return 0;
  }
};

module.exports = { getRedisClient, cacheGet, cacheSet, cacheDel, cacheIncr };
