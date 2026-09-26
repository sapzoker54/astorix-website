'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../config/database');
const { cacheGet, cacheSet, cacheDel } = require('../config/redis');
const { authenticate, generateAccessToken, generateRefreshToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { logger, auditLogger } = require('../utils/logger');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

// Validation schemas
const registerSchema = Joi.object({
  org_name:     Joi.string().min(2).max(255).required(),
  org_type:     Joi.string().valid('city_department', 'small_business', 'enterprise').required(),
  first_name:   Joi.string().min(1).max(100).required(),
  last_name:    Joi.string().min(1).max(100).required(),
  email:        Joi.string().email().lowercase().required(),
  password:     Joi.string().min(12).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/).required()
                   .messages({ 'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character' }),
  contact_phone: Joi.string().pattern(/^\+?[\d\s\-()]{7,20}$/).optional(),
  zip_code:     Joi.string().pattern(/^\d{5}(-\d{4})?$/).optional(),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

// ============================================================
// POST /api/auth/register
// Create a new organization + owner account
// ============================================================
router.post('/register', authLimiter, async (req, res) => {
  const { error, value } = registerSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({ error: 'Validation failed', details: error.details.map(d => d.message) });
  }

  const { org_name, org_type, first_name, last_name, email, password, contact_phone, zip_code } = value;

  try {
    // Check email uniqueness
    const existing = await query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists', code: 'EMAIL_EXISTS' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const orgSlug = org_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 100) + '-' + Date.now().toString(36);
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14-day trial

    const result = await transaction(async (client) => {
      // Create organization
      const orgResult = await client.query(
        `INSERT INTO organizations (name, slug, type, subscription_tier, subscription_status, trial_ends_at, contact_name, contact_phone, zip_code)
         VALUES ($1, $2, $3, 'trial', 'active', $4, $5, $6, $7)
         RETURNING id, name, slug, subscription_tier, trial_ends_at`,
        [org_name, orgSlug, org_type, trialEndsAt, `${first_name} ${last_name}`, contact_phone || null, zip_code || null]
      );
      const org = orgResult.rows[0];

      // Create owner user
      const userResult = await client.query(
        `INSERT INTO users (organization_id, email, first_name, last_name, role, password_hash, email_verified)
         VALUES ($1, $2, $3, $4, 'owner', $5, false)
         RETURNING id, email, first_name, last_name, role`,
        [org.id, email, first_name, last_name, passwordHash]
      );
      const user = userResult.rows[0];

      return { org, user };
    });

    const accessToken  = generateAccessToken(result.user.id);
    const refreshToken = generateRefreshToken(result.user.id);

    // Store refresh token hash
    const refreshHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
    await query(`UPDATE users SET refresh_token_hash=$1, refresh_token_expires=NOW()+'30d'::interval WHERE id=$2`, [refreshHash, result.user.id]);

    auditLogger.info('user.register', { userId: result.user.id, orgId: result.org.id, email, ip: req.ip });

    res.status(201).json({
      message: 'Account created. 14-day trial starts now.',
      access_token: accessToken,
      refresh_token: refreshToken,
      user: { id: result.user.id, email, first_name, last_name, role: 'owner' },
      organization: { id: result.org.id, name: org_name, slug: orgSlug, subscription_tier: 'trial', trial_ends_at: trialEndsAt },
    });
  } catch (err) {
    logger.error('Registration error', { error: err.message, email });
    res.status(500).json({ error: 'Registration failed. Please try again.', code: 'REGISTRATION_ERROR' });
  }
});

// ============================================================
// POST /api/auth/login
// ============================================================
router.post('/login', authLimiter, async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: 'Email and password are required', code: 'VALIDATION_ERROR' });
  }

  const { email, password } = value;

  try {
    const result = await query(
      `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.role, u.is_active,
              u.failed_login_count, u.locked_until, u.organization_id,
              o.name AS org_name, o.slug AS org_slug, o.subscription_tier, o.subscription_status, o.trial_ends_at
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE u.email = $1 AND u.deleted_at IS NULL`,
      [email]
    );

    if (result.rows.length === 0) {
      // Use constant-time comparison to prevent timing attacks
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingprotection00000000000000000000');
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    const user = result.rows[0];

    // Check account lock
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const waitMin = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      return res.status(423).json({ error: `Account locked. Try again in ${waitMin} minutes.`, code: 'ACCOUNT_LOCKED' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account disabled. Contact support@astorix.ai', code: 'ACCOUNT_DISABLED' });
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);

    if (!passwordValid) {
      const failCount = (user.failed_login_count || 0) + 1;
      const lockUntil = failCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await query(`UPDATE users SET failed_login_count=$1, locked_until=$2 WHERE id=$3`, [failCount, lockUntil, user.id]);
      auditLogger.warn('user.login.failed', { userId: user.id, email, ip: req.ip, failCount });
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    // Reset fail count on success
    const accessToken  = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    const refreshHash  = require('crypto').createHash('sha256').update(refreshToken).digest('hex');

    await query(`UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=NOW(), refresh_token_hash=$1, refresh_token_expires=NOW()+'30d'::interval WHERE id=$2`,
      [refreshHash, user.id]);

    // Invalidate user cache
    await cacheDel(`user:${user.id}`);

    auditLogger.info('user.login', { userId: user.id, orgId: user.organization_id, email, ip: req.ip });

    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      user: { id: user.id, email, first_name: user.first_name, last_name: user.last_name, role: user.role },
      organization: { id: user.organization_id, name: user.org_name, slug: user.org_slug, subscription_tier: user.subscription_tier },
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ error: 'Login failed. Please try again.', code: 'LOGIN_ERROR' });
  }
});

// ============================================================
// POST /api/auth/refresh
// ============================================================
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required', code: 'MISSING_TOKEN' });

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET);
    if (decoded.type !== 'refresh') return res.status(401).json({ error: 'Invalid token type', code: 'INVALID_TOKEN' });

    const refreshHash = require('crypto').createHash('sha256').update(refresh_token).digest('hex');
    const result = await query(
      `SELECT id FROM users WHERE id=$1 AND refresh_token_hash=$2 AND refresh_token_expires > NOW() AND deleted_at IS NULL`,
      [decoded.userId, refreshHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Token invalid or expired', code: 'TOKEN_INVALID' });
    }

    const newAccessToken  = generateAccessToken(decoded.userId);
    const newRefreshToken = generateRefreshToken(decoded.userId);
    const newRefreshHash  = require('crypto').createHash('sha256').update(newRefreshToken).digest('hex');

    await query(`UPDATE users SET refresh_token_hash=$1, refresh_token_expires=NOW()+'30d'::interval WHERE id=$2`, [newRefreshHash, decoded.userId]);
    await cacheDel(`user:${decoded.userId}`);

    res.json({ access_token: newAccessToken, refresh_token: newRefreshToken, expires_in: 3600 });
  } catch (err) {
    return res.status(401).json({ error: 'Token refresh failed', code: 'REFRESH_FAILED' });
  }
});

// ============================================================
// POST /api/auth/logout
// ============================================================
router.post('/logout', authenticate, async (req, res) => {
  await query('UPDATE users SET refresh_token_hash=NULL, refresh_token_expires=NULL WHERE id=$1', [req.user.id]);
  await cacheDel(`user:${req.user.id}`);
  auditLogger.info('user.logout', { userId: req.user.id, orgId: req.organizationId, ip: req.ip });
  res.json({ message: 'Logged out successfully' });
});

// ============================================================
// GET /api/auth/me
// ============================================================
router.get('/me', authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user.id, email: req.user.email,
      first_name: req.user.first_name, last_name: req.user.last_name, role: req.user.role,
    },
    organization: {
      id: req.user.organization_id, name: req.user.org_name, slug: req.user.org_slug,
      subscription_tier: req.user.subscription_tier, subscription_status: req.user.subscription_status,
      trial_ends_at: req.user.trial_ends_at,
    },
  });
});

module.exports = router;
