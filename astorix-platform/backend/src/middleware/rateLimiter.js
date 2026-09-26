'use strict';
const rateLimit = require('express-rate-limit');
const { cacheIncr } = require('../config/redis');
const { logger } = require('../utils/logger');

/**
 * Subscription-aware rate limiting
 * Limits vary by subscription tier
 */
const TIER_LIMITS = {
  trial:      { windowMs: 60 * 60 * 1000, max: 100 },   // 100/hour
  basic:      { windowMs: 60 * 60 * 1000, max: 500 },   // 500/hour
  pro:        { windowMs: 60 * 60 * 1000, max: 2000 },  // 2000/hour
  civicops:   { windowMs: 60 * 60 * 1000, max: 10000 }, // 10000/hour
  enterprise: { windowMs: 60 * 60 * 1000, max: 100000 },
};

/**
 * Per-IP rate limiter for public endpoints (login, register)
 * Prevents brute force attacks
 */
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in 15 minutes.', code: 'RATE_LIMITED' },
  keyGenerator: (req) => req.ip,
  handler: (req, res, next, options) => {
    logger.warn('Rate limit hit on public endpoint', { ip: req.ip, path: req.path });
    res.status(429).json(options.message);
  },
});

/**
 * Strict limiter for auth endpoints (login attempts)
 * 5 attempts per 15 minutes per IP
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.', code: 'AUTH_RATE_LIMITED' },
  keyGenerator: (req) => `auth:${req.ip}:${req.body?.email || 'unknown'}`,
  handler: (req, res, next, options) => {
    logger.warn('Auth rate limit hit', { ip: req.ip, email: req.body?.email });
    res.status(429).json(options.message);
  },
});

/**
 * Subscription-tier-aware limiter for API endpoints
 * Uses Redis for distributed rate limiting (works across multiple instances)
 */
const apiLimiter = async (req, res, next) => {
  if (!req.user) return next();

  const tier = req.user.subscription_tier || 'trial';
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.trial;
  const windowSeconds = limits.windowMs / 1000;
  const key = `ratelimit:api:${req.organizationId}:${Math.floor(Date.now() / limits.windowMs)}`;

  try {
    const count = await cacheIncr(key, windowSeconds);

    res.set('X-RateLimit-Limit', limits.max);
    res.set('X-RateLimit-Remaining', Math.max(0, limits.max - count));
    res.set('X-RateLimit-Tier', tier);

    if (count > limits.max) {
      logger.warn('API rate limit exceeded', { org: req.organizationId, tier, count, max: limits.max });
      return res.status(429).json({
        error: 'API rate limit exceeded for your subscription tier',
        code: 'API_RATE_LIMITED',
        current_tier: tier,
        limit: limits.max,
        window: '1 hour',
        upgrade_url: `${process.env.APP_URL}/billing/upgrade`,
      });
    }
  } catch (err) {
    // If Redis is down, allow the request through (fail open for availability)
    logger.error('Rate limiter Redis error — allowing request', { error: err.message });
  }

  next();
};

module.exports = { publicLimiter, authLimiter, apiLimiter };
