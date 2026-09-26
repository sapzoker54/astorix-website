-- ============================================================
-- ASTORIX Platform — PostgreSQL Schema v1.0
-- Multi-tenant, CCPA-compliant, scalable to millions of users
-- Gensis.AI Inc. | ASTORIX.AI | Proprietary & Confidential
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- Fast text search

-- ============================================================
-- TENANTS (Organizations)
-- Each City of LA department or business is one tenant
-- ============================================================
CREATE TABLE organizations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(255) NOT NULL,
    slug                VARCHAR(100) UNIQUE NOT NULL,  -- e.g. "city-of-la-public-works"
    type                VARCHAR(50) NOT NULL CHECK (type IN ('city_department', 'small_business', 'enterprise', 'trial')),
    subscription_tier   VARCHAR(50) NOT NULL DEFAULT 'trial' CHECK (subscription_tier IN ('trial', 'basic', 'pro', 'civicops', 'enterprise')),
    subscription_status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'past_due', 'cancelled', 'trial')),
    trial_ends_at       TIMESTAMPTZ,
    stripe_customer_id  VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    monthly_price_cents INTEGER,                        -- 29900=Basic, 9900=Pro, 29900=CivicOps
    billing_email       VARCHAR(255),
    city                VARCHAR(100) DEFAULT 'Los Angeles',
    state               VARCHAR(50) DEFAULT 'CA',
    zip_code            VARCHAR(10),
    contact_name        VARCHAR(255),
    contact_phone       VARCHAR(20),
    -- Compliance
    ccpa_opt_out        BOOLEAN DEFAULT FALSE,
    data_processing_agreement BOOLEAN DEFAULT FALSE,
    dpa_signed_at       TIMESTAMPTZ,
    dpa_signed_by       VARCHAR(255),
    -- Metadata
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,                    -- Soft delete for CCPA
    is_active           BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_type ON organizations(type);
CREATE INDEX idx_organizations_subscription_tier ON organizations(subscription_tier);
CREATE INDEX idx_organizations_stripe_customer ON organizations(stripe_customer_id);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email               VARCHAR(255) NOT NULL,
    email_verified      BOOLEAN DEFAULT FALSE,
    first_name          VARCHAR(100),
    last_name           VARCHAR(100),
    role                VARCHAR(50) NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
    -- Auth
    password_hash       VARCHAR(255),                   -- bcrypt
    azure_oid           VARCHAR(255),                   -- Azure AD B2C object ID
    last_login_at       TIMESTAMPTZ,
    failed_login_count  INTEGER DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    mfa_enabled         BOOLEAN DEFAULT FALSE,
    mfa_secret          VARCHAR(255),                   -- encrypted TOTP secret
    -- Session
    refresh_token_hash  VARCHAR(255),
    refresh_token_expires TIMESTAMPTZ,
    -- Preferences
    timezone            VARCHAR(50) DEFAULT 'America/Los_Angeles',
    notification_email  BOOLEAN DEFAULT TRUE,
    -- CCPA
    ccpa_data_deletion_requested_at TIMESTAMPTZ,
    -- Metadata
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    is_active           BOOLEAN DEFAULT TRUE
);

CREATE UNIQUE INDEX idx_users_email_org ON users(email, organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_organization ON users(organization_id);
CREATE INDEX idx_users_azure_oid ON users(azure_oid);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- SUBSCRIPTION PLANS (reference table)
-- ============================================================
CREATE TABLE subscription_plans (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(100) NOT NULL,
    tier                VARCHAR(50) NOT NULL UNIQUE,
    monthly_price_cents INTEGER NOT NULL,
    annual_price_cents  INTEGER,
    max_users           INTEGER,
    max_api_calls_per_hour INTEGER,
    features            JSONB NOT NULL DEFAULT '{}',
    stripe_price_id_monthly VARCHAR(255),
    stripe_price_id_annual  VARCHAR(255),
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO subscription_plans (name, tier, monthly_price_cents, annual_price_cents, max_users, max_api_calls_per_hour, features) VALUES
('Free Trial',    'trial',    0,      0,       3,    100,  '{"311_data":true,"district_count":1,"earthquake_feed":true,"weather_alerts":true,"export":false,"api_access":false,"sla":"none"}'),
('BusinessAlert Basic', 'basic', 2900, 29000, 5,   500,  '{"311_data":true,"district_count":3,"earthquake_feed":true,"weather_alerts":true,"export":"csv","api_access":false,"sla":"business_hours"}'),
('BusinessAlert Pro',   'pro',   9900, 99000, 25,  2000, '{"311_data":true,"district_count":15,"earthquake_feed":true,"weather_alerts":true,"export":"csv_pdf","api_access":true,"sla":"24x7","custom_alerts":true}'),
('CivicOps',      'civicops', 29900, 299000, 100, 10000,'{"311_data":true,"district_count":15,"earthquake_feed":true,"weather_alerts":true,"export":"csv_pdf_api","api_access":true,"sla":"24x7","custom_alerts":true,"admin_console":true,"audit_logs":true,"white_label":false,"dedicated_support":true}'),
('Enterprise',    'enterprise', 0,    0,      999, 100000,'{"311_data":true,"district_count":15,"earthquake_feed":true,"weather_alerts":true,"export":"all","api_access":true,"sla":"24x7_dedicated","custom_alerts":true,"admin_console":true,"audit_logs":true,"white_label":true,"dedicated_support":true,"custom_integrations":true}');

-- ============================================================
-- API USAGE TRACKING (for billing and rate limiting)
-- ============================================================
CREATE TABLE api_usage (
    id                  BIGSERIAL PRIMARY KEY,
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    endpoint            VARCHAR(255) NOT NULL,
    method              VARCHAR(10) NOT NULL,
    status_code         INTEGER,
    response_time_ms    INTEGER,
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Monthly partitions for performance at scale
CREATE TABLE api_usage_2026_09 PARTITION OF api_usage FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE api_usage_2026_10 PARTITION OF api_usage FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE api_usage_2026_11 PARTITION OF api_usage FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE api_usage_2026_12 PARTITION OF api_usage FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE api_usage_2027_01 PARTITION OF api_usage FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE INDEX idx_api_usage_org_created ON api_usage(organization_id, created_at);
CREATE INDEX idx_api_usage_created ON api_usage(created_at);

-- ============================================================
-- AUDIT LOG (SOC 2 / City of LA compliance)
-- ============================================================
CREATE TABLE audit_logs (
    id                  BIGSERIAL PRIMARY KEY,
    organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    action              VARCHAR(100) NOT NULL,          -- e.g. 'user.login', 'data.export', 'subscription.upgrade'
    resource_type       VARCHAR(100),
    resource_id         VARCHAR(255),
    old_values          JSONB,
    new_values          JSONB,
    ip_address          INET,
    user_agent          TEXT,
    success             BOOLEAN DEFAULT TRUE,
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_logs_2026_09 PARTITION OF audit_logs FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_logs_2027_01 PARTITION OF audit_logs FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id, created_at);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

-- ============================================================
-- SAVED ALERTS / NOTIFICATIONS
-- ============================================================
CREATE TABLE alert_configs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    alert_type          VARCHAR(50) NOT NULL CHECK (alert_type IN ('earthquake', 'weather', '311_spike', 'infrastructure_score', 'network')),
    conditions          JSONB NOT NULL,                 -- e.g. {"magnitude_min": 3.0, "districts": [5, 11]}
    notify_email        BOOLEAN DEFAULT TRUE,
    notify_webhook      VARCHAR(500),
    is_active           BOOLEAN DEFAULT TRUE,
    last_triggered_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_configs_org ON alert_configs(organization_id);

-- ============================================================
-- CCPA DATA DELETION REQUESTS
-- California Consumer Privacy Act compliance
-- ============================================================
CREATE TABLE ccpa_deletion_requests (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    requestor_email     VARCHAR(255) NOT NULL,
    request_type        VARCHAR(50) NOT NULL CHECK (request_type IN ('delete', 'export', 'opt_out_sale')),
    status              VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'denied')),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    notes               TEXT
);

-- ============================================================
-- INVITATIONS (Team management)
-- ============================================================
CREATE TABLE invitations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invited_by          UUID NOT NULL REFERENCES users(id),
    email               VARCHAR(255) NOT NULL,
    role                VARCHAR(50) NOT NULL DEFAULT 'viewer',
    token_hash          VARCHAR(255) NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_token ON invitations(token_hash);
CREATE INDEX idx_invitations_email ON invitations(email);

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_alert_configs_updated_at BEFORE UPDATE ON alert_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
