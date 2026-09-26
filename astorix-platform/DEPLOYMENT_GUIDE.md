# ASTORIX Commercial Platform — Deployment Guide
## Gensis.AI Inc. | ASTORIX.AI | Proprietary & Confidential
## Azure Subscription: c22ac7c4-b4c1-4eb6-b4c4-19557268f706

---

## WHAT WAS BUILT

| Component | Description | Technology |
|-----------|-------------|------------|
| **Backend API** | Multi-tenant REST API, auth, rate limiting, CCPA compliance | Node.js 18, Express 4, PostgreSQL 15 |
| **Database** | Multi-tenant schema: orgs, users, subscriptions, audit logs, CCPA | PostgreSQL 15 (Azure Flexible Server) |
| **Cache** | API response caching, rate limiting (reduces LA311/NOAA API calls) | Redis 6 (Azure Cache for Redis) |
| **CivicOps Dashboard** | Commercial web app for City of LA departments | HTML/CSS/JS, no frameworks |
| **CivicOps Login** | Registration + login with 14-day trial | Same stack |
| **Azure IaC** | Infrastructure-as-code for all Azure resources | Bicep |
| **CI/CD Pipeline** | Automated test + deploy on every push to main | GitHub Actions |

## PRICING TIERS BUILT IN

| Tier | Price | Users | API Calls/hr | Districts |
|------|-------|-------|--------------|-----------|
| Trial | Free 14 days | 3 | 100 | 1 |
| BusinessAlert Basic | $29/mo | 5 | 500 | 3 |
| BusinessAlert Pro | $99/mo | 25 | 2,000 | 15 |
| **CivicOps** | **$299/mo** | 100 | 10,000 | 15 |
| Enterprise | Custom | Unlimited | 100,000 | 15 |

---

## PHASE 1: AZURE SETUP (one-time, 30 min)

### Step 1.1 — Create Azure Resource Group

Go to: https://portal.azure.com
- Search "Resource groups" → Create
- Name: `astorix-rg`
- Region: `West US 2` (closest to Los Angeles)
- Subscription: c22ac7c4-b4c1-4eb6-b4c4-19557268f706
- Click **Review + Create**

### Step 1.2 — Deploy Infrastructure via Bicep

From Azure Cloud Shell (bash):
```bash
az deployment group create \
  --resource-group astorix-rg \
  --template-file infrastructure/azure/main.bicep \
  --parameters env=prod \
               dbPassword='YourStrongPassword123!' \
               jwtSecret=$(openssl rand -hex 64)
```

This creates:
- Azure App Service (Node.js API) — `astorix-prod-api`
- Azure PostgreSQL Flexible Server — `astorix-prod-db`
- Azure Cache for Redis — `astorix-prod-cache`
- Azure Static Web Apps (frontend) — `astorix-prod-frontend`
- Log Analytics Workspace

### Step 1.3 — Run Database Migrations

```bash
# Get the PostgreSQL connection string from Azure Portal
psql "host=astorix-prod-db.postgres.database.azure.com dbname=astorix_platform user=astorix_admin sslmode=require" \
  -f backend/migrations/001_initial_schema.sql
```

---

## PHASE 2: GITHUB SETUP (10 min)

### Step 2.1 — Create GitHub Secrets

Go to: github.com/sapzoker54/astorix-website → Settings → Secrets → Actions

Add these secrets:
```
AZURE_CREDENTIALS          = {JSON from: az ad sp create-for-rbac --name astorix-deploy --role contributor --scopes /subscriptions/c22ac7c4-.../resourceGroups/astorix-rg}
AZURE_STATIC_WEB_APPS_API_TOKEN = (from Azure Portal → Static Web App → Manage deployment token)
```

### Step 2.2 — Push Platform Code

Copy the `astorix-platform/` folder to your GitHub repo root:
```
sapzoker54/astorix-website/
├── ios-apps/          (existing — iOS apps, DO NOT TOUCH)
├── astorix-platform/  (NEW — commercial SaaS platform)
│   ├── backend/
│   ├── frontend/
│   ├── infrastructure/
│   └── .github/
```

GitHub Actions will automatically:
1. Run tests
2. Deploy backend to Azure App Service
3. Deploy frontend to Azure Static Web Apps

---

## PHASE 3: CUSTOM DOMAIN (15 min)

### Add app.astorix.ai → Azure Static Web Apps
In Azure Portal → Static Web App → Custom domains:
- Add: `app.astorix.ai`
- Add CNAME record in your DNS: `app.astorix.ai → astorix-prod-frontend.azurestaticapps.net`

### Add api.astorix.ai → Azure App Service
- Add: `api.astorix.ai`  
- Add CNAME: `api.astorix.ai → astorix-prod-api.azurewebsites.net`

---

## COMPLIANCE — CITY OF LA / CALIFORNIA

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| CCPA Privacy Rights | ✅ Built | `/api/privacy/ccpa-request` endpoint, data deletion workflow |
| WCAG 2.1 AA | ✅ Built | Accessible HTML, ARIA labels, keyboard navigation |
| HTTPS Only | ✅ Built | App Service httpsOnly=true, HSTS headers |
| SQL Injection Prevention | ✅ Built | Parameterized queries throughout |
| XSS Prevention | ✅ Built | Helmet CSP headers, input sanitization |
| Brute Force Protection | ✅ Built | Account lockout after 5 failed attempts, rate limiting |
| Audit Logging | ✅ Built | Every auth event logged to audit_logs table |
| Data Encryption | ✅ Built | TLS 1.2+ required, passwords bcrypt-hashed (12 rounds) |
| Session Security | ✅ Built | JWT with 1hr expiry, 30-day refresh tokens |
| SOC 2 Alignment | ✅ Built | Audit logs, 90-day log retention, Log Analytics |

---

## PRODUCTION COSTS (estimate)

| Service | Tier | Monthly Cost |
|---------|------|-------------|
| Azure App Service | P2v3 | ~$147 |
| Azure PostgreSQL | D2s_v3 | ~$120 |
| Azure Cache for Redis | Standard C1 | ~$55 |
| Azure Static Web Apps | Standard | ~$9 |
| Log Analytics | Per GB | ~$5 |
| **Total** | | **~$336/mo** |

**Revenue needed to break even: 2 CivicOps customers ($299 × 2 = $598)**

---

*Prepared by Gensis.AI Inc. development team — September 25, 2026*
*Apple Team ID: GV32459XCX | ASTORIX.AI*
