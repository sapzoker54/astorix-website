'use strict';
const express = require('express');
const Joi = require('joi');
const { authenticate, requireTier } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');
const { getCivicOpsDashboard, getLA311Data, getEarthquakeData, getWeatherAlerts } = require('../services/dataService');
const { query } = require('../config/database');
const { logger, auditLogger } = require('../utils/logger');

const router = express.Router();

// All CivicOps routes require authentication + subscription
router.use(authenticate);
router.use(apiLimiter);

// ============================================================
// GET /api/civicops/dashboard
// Main dashboard — all data sources combined
// Available: all tiers
// ============================================================
router.get('/dashboard', async (req, res) => {
  try {
    const districts = req.query.districts ? req.query.districts.split(',').map(Number).filter(d => d >= 1 && d <= 15) : null;
    const data = await getCivicOpsDashboard(req.organizationId, { districts });

    // Log API usage (async, non-blocking)
    query(`INSERT INTO api_usage (organization_id, user_id, endpoint, method, status_code, response_time_ms, ip_address)
           VALUES ($1, $2, '/api/civicops/dashboard', 'GET', 200, 0, $3)`,
          [req.organizationId, req.user.id, req.ip]).catch(() => {});

    res.json(data);
  } catch (err) {
    logger.error('CivicOps dashboard error', { error: err.message, org: req.organizationId });
    res.status(502).json({ error: 'Unable to fetch dashboard data', code: 'DATA_ERROR', detail: err.message });
  }
});

// ============================================================
// GET /api/civicops/311
// LA 311 service requests with filtering
// ============================================================
router.get('/311', async (req, res) => {
  const schema = Joi.object({
    districts:  Joi.string().pattern(/^[\d,]+$/).optional(),
    categories: Joi.string().optional(),
    limit:      Joi.number().integer().min(1).max(5000).default(500),
  });

  const { error, value } = schema.validate(req.query);
  if (error) return res.status(400).json({ error: error.details[0].message });

  // Tier check for district count
  const tier = req.user.subscription_tier;
  const tierDistrictLimits = { trial: 1, basic: 3, pro: 15, civicops: 15, enterprise: 15 };
  const maxDistricts = tierDistrictLimits[tier] || 1;

  const districts = value.districts ? value.districts.split(',').map(Number).slice(0, maxDistricts) : null;
  const categories = value.categories ? value.categories.split(',') : null;

  try {
    const data = await getLA311Data({ districts, categories, limit: value.limit });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message, code: 'LA311_ERROR' });
  }
});

// ============================================================
// GET /api/civicops/earthquakes
// USGS seismic data
// ============================================================
router.get('/earthquakes', async (req, res) => {
  const radiusKm = Math.min(parseInt(req.query.radius_km) || 100, 500);
  const minMag   = Math.max(parseFloat(req.query.min_magnitude) || 1.0, 0);

  try {
    const data = await getEarthquakeData(radiusKm, minMag);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message, code: 'USGS_ERROR' });
  }
});

// ============================================================
// GET /api/civicops/weather
// NOAA weather alerts
// ============================================================
router.get('/weather', async (req, res) => {
  try {
    const data = await getWeatherAlerts();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message, code: 'NOAA_ERROR' });
  }
});

// ============================================================
// GET /api/civicops/export
// Export data as CSV — Pro+ tiers only
// ============================================================
router.get('/export', requireTier('pro', 'civicops', 'enterprise'), async (req, res) => {
  try {
    const data = await getCivicOpsDashboard(req.organizationId);
    const rows = (data.la311?.recent_requests || []);

    const csv = [
      ['SR Number', 'Type', 'Status', 'Created', 'Council District', 'Latitude', 'Longitude', 'Address'].join(','),
      ...rows.map(r => [
        r.srnumber || '', r.requesttype || '', r.status || '',
        r.createddate || '', r.cd || '', r.latitude || '', r.longitude || '', `"${(r.address || '').replace(/"/g, '""')}"`,
      ].join(','))
    ].join('\n');

    auditLogger.info('data.export', { userId: req.user.id, orgId: req.organizationId, type: 'csv', rows: rows.length });

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="astorix-civicops-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_ERROR' });
  }
});

// ============================================================
// GET /api/civicops/alerts
// Get/manage custom alert configurations — CivicOps+ only
// ============================================================
router.get('/alerts', requireTier('pro', 'civicops', 'enterprise'), async (req, res) => {
  const result = await query(
    'SELECT id, name, alert_type, conditions, notify_email, is_active, last_triggered_at, created_at FROM alert_configs WHERE organization_id=$1 ORDER BY created_at DESC',
    [req.organizationId]
  );
  res.json({ alerts: result.rows });
});

router.post('/alerts', requireTier('pro', 'civicops', 'enterprise'), async (req, res) => {
  const schema = Joi.object({
    name:           Joi.string().min(1).max(255).required(),
    alert_type:     Joi.string().valid('earthquake', 'weather', '311_spike', 'infrastructure_score').required(),
    conditions:     Joi.object().required(),
    notify_email:   Joi.boolean().default(true),
    notify_webhook: Joi.string().uri().optional(),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const result = await query(
    'INSERT INTO alert_configs (organization_id, user_id, name, alert_type, conditions, notify_email, notify_webhook) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [req.organizationId, req.user.id, value.name, value.alert_type, JSON.stringify(value.conditions), value.notify_email, value.notify_webhook || null]
  );

  res.status(201).json({ alert: result.rows[0] });
});

// ============================================================
// GET /api/civicops/usage
// API usage for this organization — admin only
// ============================================================
router.get('/usage', async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 90);
  const result = await query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS requests, AVG(response_time_ms)::int AS avg_response_ms
     FROM api_usage WHERE organization_id=$1 AND created_at > NOW() - ($2 || ' days')::INTERVAL
     GROUP BY DATE(created_at) ORDER BY date DESC`,
    [req.organizationId, days]
  );
  res.json({ usage: result.rows, period_days: days });
});

module.exports = router;
