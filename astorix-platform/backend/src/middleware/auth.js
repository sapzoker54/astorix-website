'use strict';
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { cacheGet, cacheSet } = require('../config/redis');
const { logger } = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable is not set');
}

/**
 * Verify JWT and load user + organization into req
 * Caches user lookup in Redis for 60 seconds
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }

    // Check user in cache first
    const cacheKey = `user:${decoded.userId}`;
    let userData = await cacheGet(cacheKey);

    if (!userData) {
      const result = await query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active, u.organization_id,
                o.name AS org_name, o.slug AS org_slug, o.subscription_tier, o.subscription_status,
                o.is_active AS org_active, o.trial_ends_at
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
         WHERE u.id = $1 AND u.deleted_at IS NULL`,
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      }

      userData = result.rows[0];
      await cacheSet(cacheKey, userData, 60);
    }

    if (!userData.is_active) {
      return res.status(403).json({ error: 'Account is disabled', code: 'ACCOUNT_DISABLED' });
    }

    if (!userData.org_active) {
      return res.status(403).json({ error: 'Organization account is disabled', code: 'ORG_DISABLED' });
    }

    // Check trial expiry
    if (userData.subscription_tier === 'trial' && userData.trial_ends_at) {
      if (new Date(userData.trial_ends_at) < new Date()) {
        return res.status(402).json({ error: 'Trial period has ended. Please upgrade to continue.', code: 'TRIAL_EXPIRED' });
      }
    }

    if (userData.subscription_status === 'cancelled') {
      return res.status(402).json({ error: 'Subscription cancelled. Please reactivate.', code: 'SUBSCRIPTION_CANCELLED' });
    }

    req.user = userData;
    req.organizationId = userData.organization_id;
    next();
  } catch (err) {
    logger.error('Authentication error', { error: err.message });
    return res.status(500).json({ error: 'Authentication failed', code: 'AUTH_ERROR' });
  }
};

/**
 * Role-based access control
 * Usage: requireRole('admin', 'owner')
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}`, code: 'FORBIDDEN' });
  }
  next();
};

/**
 * Subscription tier gate
 * Usage: requireTier('pro', 'civicops', 'enterprise')
 */
const requireTier = (...tiers) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
  if (!tiers.includes(req.user.subscription_tier)) {
    return res.status(402).json({
      error: 'This feature requires a higher subscription tier',
      code: 'UPGRADE_REQUIRED',
      required_tiers: tiers,
      current_tier: req.user.subscription_tier,
      upgrade_url: `${process.env.APP_URL}/billing/upgrade`,
    });
  }
  next();
};

/**
 * Generate access token
 */
const generateAccessToken = (userId) => {
  return jwt.sign({ userId, type: 'access' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, issuer: 'astorix.ai' });
};

/**
 * Generate refresh token (longer-lived)
 */
const generateRefreshToken = (userId) => {
  return jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d', issuer: 'astorix.ai' });
};

module.exports = { authenticate, requireRole, requireTier, generateAccessToken, generateRefreshToken };
