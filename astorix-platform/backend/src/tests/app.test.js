'use strict';
/**
 * ASTORIX Platform — Integration Tests
 * Tests all critical API endpoints with mocked DB + Redis
 * Runs in CI without real Azure connections
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_64_chars_minimum_for_tests_only_never_production!!';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'astorix_test';
process.env.DB_USER = 'astorix_admin';
process.env.DB_PASSWORD = 'test_password_ci';
process.env.DB_SSL = 'false';
process.env.REDIS_URL = 'redis://localhost:6379';

const request = require('supertest');

// ── Mock database (no real Postgres needed for unit tests) ──
jest.mock('../config/database', () => {
  const mockOrg = {
    id: 'org-test-uuid',
    name: 'Test City Department',
    slug: 'test-city-dept',
    plan_name: 'civicops',
    status: 'active',
    trial_ends_at: null,
    monthly_api_limit: 10000,
    api_calls_this_hour: 0,
    allowed_districts: 15,
  };
  const mockUser = {
    id: 'user-test-uuid',
    organization_id: 'org-test-uuid',
    email: 'test@lacity.org',
    first_name: 'Test',
    last_name: 'User',
    role: 'admin',
    status: 'active',
    failed_login_attempts: 0,
    locked_until: null,
    // bcrypt hash of 'TestPassword123!'
    password_hash: '$2a$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  };

  const mockQuery = jest.fn().mockImplementation((text) => {
    // Registration — org insert
    if (text.includes('INSERT INTO organizations')) {
      return Promise.resolve({ rows: [{ id: 'new-org-uuid', slug: 'new-org', status: 'trialing', trial_ends_at: new Date(Date.now() + 14*86400000) }] });
    }
    // Registration — user insert
    if (text.includes('INSERT INTO users')) {
      return Promise.resolve({ rows: [{ id: 'new-user-uuid', role: 'admin' }] });
    }
    // Login — fetch user
    if (text.includes('SELECT u.*, o.') && text.includes('WHERE u.email')) {
      return Promise.resolve({ rows: [mockUser] });
    }
    // Login — fetch org
    if (text.includes('SELECT * FROM organizations WHERE id')) {
      return Promise.resolve({ rows: [mockOrg] });
    }
    // Update login attempts / locked_until
    if (text.includes('UPDATE users SET')) {
      return Promise.resolve({ rows: [] });
    }
    // Store refresh token
    if (text.includes('refresh_token_hash')) {
      return Promise.resolve({ rows: [] });
    }
    // Audit log
    if (text.includes('INSERT INTO audit_logs')) {
      return Promise.resolve({ rows: [] });
    }
    // API usage
    if (text.includes('INSERT INTO api_usage') || text.includes('SELECT SUM') || text.includes('DATE(created_at)')) {
      return Promise.resolve({ rows: [] });
    }
    // CCPA insert
    if (text.includes('ccpa_deletion_requests')) {
      return Promise.resolve({ rows: [] });
    }
    // Health check
    if (text.includes('SELECT NOW()')) {
      return Promise.resolve({ rows: [{ now: new Date() }] });
    }
    return Promise.resolve({ rows: [] });
  });

  return {
    query: mockQuery,
    getClient: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    }),
    transaction: jest.fn().mockImplementation(async (fn) => {
      const client = {
        query: mockQuery,
        release: jest.fn(),
      };
      return await fn(client);
    }),
    healthCheck: jest.fn().mockResolvedValue({ status: 'ok', latency_ms: 1 }),
  };
});

// ── Mock Redis (no real Redis needed for unit tests) ──
jest.mock('../config/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue('OK'),
  cacheDel: jest.fn().mockResolvedValue(1),
  cacheIncr: jest.fn().mockResolvedValue(1),
  client: { isReady: true },
}));

// ── Mock data service ──
jest.mock('../services/dataService', () => ({
  getCivicOpsDashboard: jest.fn().mockResolvedValue({
    city_health_score: 78,
    city_status: 'NORMAL',
    generated_at: new Date().toISOString(),
    la311: { health_score: 80, total_open: 1200 },
    seismic: { risk_level: 'LOW', recent_count: 3 },
    weather: { active_alerts: 0 },
  }),
  getLA311Data: jest.fn().mockResolvedValue({ health_score: 80, total_open: 1200, requests: [] }),
  getEarthquakeData: jest.fn().mockResolvedValue({ risk_level: 'LOW', earthquakes: [] }),
  getWeatherAlerts: jest.fn().mockResolvedValue({ active_alerts: 0, alerts: [] }),
}));

const app = require('../app');

// ── Helper: generate a real JWT for tests ──
const jwt = require('jsonwebtoken');
function makeTestToken(userId = 'user-test-uuid') {
  return jwt.sign({ sub: userId, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// ── Mock the authenticate middleware to inject test user ──
jest.mock('../middleware/auth', () => {
  const jwt = require('jsonwebtoken');
  return {
    authenticate: jest.fn((req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
      }
      try {
        const token = authHeader.split(' ')[1];
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = {
          id: payload.sub,
          email: 'test@lacity.org',
          first_name: 'Test',
          last_name: 'User',
          role: 'admin',
          status: 'active',
          subscription_tier: 'civicops',
        };
        req.organization = {
          id: 'org-test-uuid',
          name: 'Test City Department',
          plan_name: 'civicops',
          status: 'active',
          trial_ends_at: null,
          monthly_api_limit: 10000,
          api_calls_this_hour: 0,
          allowed_districts: 15,
        };
        req.organizationId = 'org-test-uuid';
        next();
      } catch {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }),
    requireRole: (...roles) => (req, res, next) => next(),
    requireTier: (...tiers) => (req, res, next) => next(),
    generateAccessToken: (userId) => jwt.sign({ sub: userId, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '1h' }),
    generateRefreshToken: (userId) => jwt.sign({ sub: userId, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '30d' }),
  };
});

// ── Mock rate limiter (pass-through in tests) ──
jest.mock('../middleware/rateLimiter', () => ({
  publicLimiter: (req, res, next) => next(),
  authLimiter:   (req, res, next) => next(),
  apiLimiter:    (req, res, next) => next(),
}));

// =============================================================
// TEST SUITES
// =============================================================

describe('Health Endpoints', () => {
  test('GET /health returns 200 with db status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('db');
  });

  test('GET /health/ready returns 200', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
  });

  test('GET /nonexistent returns 404', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('Auth — Registration', () => {
  test('POST /api/auth/register with valid payload returns tokens', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        org_name: 'City of Los Angeles — Public Works',
        org_type: 'city_department',
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane.smith@lacity.org',
        password: 'CivicOps2026!',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('organization');
  });

  test('POST /api/auth/register with weak password returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        org_name: 'Test Org',
        org_type: 'city_department',
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane@test.com',
        password: 'weak',
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('details');
  });

  test('POST /api/auth/register with missing fields returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'incomplete@test.com' });
    expect(res.status).toBe(400);
  });

  test('POST /api/auth/register with invalid email returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        org_name: 'Test Org',
        org_type: 'city_department',
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'not-an-email',
        password: 'CivicOps2026!',
      });
    expect(res.status).toBe(400);
  });
});

describe('Auth — Login', () => {
  test('POST /api/auth/login with missing fields returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@lacity.org' });
    expect(res.status).toBe(400);
  });

  test('POST /api/auth/login with invalid email format returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'notvalid', password: 'SomePass123!' });
    expect(res.status).toBe(400);
  });
});

describe('Auth — Token Security', () => {
  test('Requests without Bearer token return 401', async () => {
    const res = await request(app).get('/api/civicops/dashboard');
    expect(res.status).toBe(401);
  });

  test('Requests with invalid token return 401', async () => {
    const res = await request(app)
      .get('/api/civicops/dashboard')
      .set('Authorization', 'Bearer invalidtoken123');
    expect(res.status).toBe(401);
  });

  test('Requests with valid token reach endpoint', async () => {
    const token = makeTestToken();
    const res = await request(app)
      .get('/api/civicops/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('city_health_score');
  });
});

describe('CivicOps Dashboard', () => {
  let token;
  beforeAll(() => { token = makeTestToken(); });

  test('GET /api/civicops/dashboard returns health data', async () => {
    const res = await request(app)
      .get('/api/civicops/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('city_health_score');
    expect(res.body).toHaveProperty('city_status');
    expect(typeof res.body.city_health_score).toBe('number');
  });

  test('GET /api/civicops/311 returns 311 data', async () => {
    const res = await request(app)
      .get('/api/civicops/311')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('health_score');
  });

  test('GET /api/civicops/usage returns usage stats', async () => {
    const res = await request(app)
      .get('/api/civicops/usage')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('CCPA Privacy Endpoint', () => {
  test('POST /api/privacy/ccpa-request with valid delete request returns 200', async () => {
    const res = await request(app)
      .post('/api/privacy/ccpa-request')
      .send({ email: 'user@example.com', request_type: 'delete' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/45 days/);
  });

  test('POST /api/privacy/ccpa-request with invalid type returns 400', async () => {
    const res = await request(app)
      .post('/api/privacy/ccpa-request')
      .send({ email: 'user@example.com', request_type: 'invalidtype' });
    expect(res.status).toBe(400);
  });

  test('POST /api/privacy/ccpa-request with missing email returns 400', async () => {
    const res = await request(app)
      .post('/api/privacy/ccpa-request')
      .send({ request_type: 'delete' });
    expect(res.status).toBe(400);
  });
});

describe('Security Headers', () => {
  test('API responses include HSTS header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers).toHaveProperty('strict-transport-security');
  });

  test('API responses include X-Content-Type-Options', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('API responses include X-Request-ID', async () => {
    const res = await request(app).get('/health');
    expect(res.headers).toHaveProperty('x-request-id');
  });
});
