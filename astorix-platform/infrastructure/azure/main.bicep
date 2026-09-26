// ============================================================
// ASTORIX Platform — Azure Infrastructure as Code
// Subscription: c22ac7c4-b4c1-4eb6-b4c4-19557268f706
// Target region: West US 2 (closest to LA)
// Gensis.AI Inc. | ASTORIX.AI | Proprietary
// ============================================================

targetScope = 'resourceGroup'

@description('Environment name: prod, staging, dev')
@allowed(['prod', 'staging', 'dev'])
param env string = 'prod'

@description('Azure region')
param location string = 'westus2'

@description('PostgreSQL admin password — set in GitHub secrets')
@secure()
param dbPassword string

@description('JWT secret — 64-byte hex string')
@secure()
param jwtSecret string

var prefix = 'astorix-${env}'
var tags = {
  Project: 'ASTORIX Platform'
  Environment: env
  Owner: 'Gensis.AI Inc.'
  CostCenter: 'ASTORIX'
}

// ============================================================
// RESOURCE GROUP LOG ANALYTICS (monitoring + compliance)
// ============================================================
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${prefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 90  // 90-day retention for audit compliance
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

// ============================================================
// AZURE CACHE FOR REDIS
// Standard C1 — 1GB, supports 1000 concurrent connections
// ============================================================
resource redis 'Microsoft.Cache/redis@2023-04-01' = {
  name: '${prefix}-cache'
  location: location
  tags: tags
  properties: {
    sku: { name: 'Standard', family: 'C', capacity: 1 }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    redisVersion: '6'
    publicNetworkAccess: 'Disabled'  // Only accessible from App Service
  }
}

// ============================================================
// POSTGRESQL FLEXIBLE SERVER
// General Purpose, 2 vCores — scales up as needed
// ============================================================
resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: '${prefix}-db'
  location: location
  tags: tags
  sku: {
    name: 'Standard_D2s_v3'  // 2 vCores, 8GB RAM
    tier: 'GeneralPurpose'
  }
  properties: {
    administratorLogin: 'astorix_admin'
    administratorLoginPassword: dbPassword
    version: '15'
    storage: {
      storageSizeGB: 128
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 30
      geoRedundantBackup: 'Enabled'
    }
    highAvailability: {
      mode: env == 'prod' ? 'ZoneRedundant' : 'Disabled'
    }
    maintenanceWindow: {
      customWindow: 'Enabled'
      dayOfWeek: 0    // Sunday
      startHour: 2    // 2am PT
      startMinute: 0
    }
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-03-01-preview' = {
  parent: postgresServer
  name: 'astorix_platform'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// ============================================================
// APP SERVICE PLAN — Linux P2v3
// 2 vCores, 8GB RAM — auto-scale to 10 instances
// ============================================================
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${prefix}-plan'
  location: location
  tags: tags
  sku: {
    name: 'P2v3'  // Production grade — $147/mo. Switch to B1 for dev.
    tier: 'PremiumV3'
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

// Auto-scale rule: scale out when CPU > 70%, scale in when CPU < 30%
resource autoScale 'Microsoft.Insights/autoscalesettings@2022-10-01' = {
  name: '${prefix}-autoscale'
  location: location
  tags: tags
  properties: {
    enabled: env == 'prod'
    targetResourceUri: appServicePlan.id
    profiles: [
      {
        name: 'Default'
        capacity: { minimum: '1', maximum: '10', default: '2' }
        rules: [
          {
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: appServicePlan.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'GreaterThan'
              threshold: 70
            }
            scaleAction: { direction: 'Increase', type: 'ChangeCount', value: '2', cooldown: 'PT5M' }
          }
          {
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: appServicePlan.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT10M'
              timeAggregation: 'Average'
              operator: 'LessThan'
              threshold: 30
            }
            scaleAction: { direction: 'Decrease', type: 'ChangeCount', value: '1', cooldown: 'PT10M' }
          }
        ]
      }
    ]
  }
}

// ============================================================
// APP SERVICE — Node.js API backend
// ============================================================
resource apiApp 'Microsoft.Web/sites@2023-01-01' = {
  name: '${prefix}-api'
  location: location
  tags: tags
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|18-lts'
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      healthCheckPath: '/health'
      appSettings: [
        { name: 'NODE_ENV',       value: env == 'prod' ? 'production' : 'development' }
        { name: 'APP_VERSION',    value: '1.0.0' }
        { name: 'APP_URL',        value: 'https://app.astorix.ai' }
        { name: 'PORT',           value: '8080' }
        { name: 'ALLOWED_ORIGINS', value: 'https://app.astorix.ai,https://astorix.ai' }
        { name: 'DB_HOST',        value: postgresServer.properties.fullyQualifiedDomainName }
        { name: 'DB_PORT',        value: '5432' }
        { name: 'DB_NAME',        value: 'astorix_platform' }
        { name: 'DB_USER',        value: 'astorix_admin' }
        { name: 'DB_PASSWORD',    value: dbPassword }
        { name: 'DB_SSL',         value: 'true' }
        { name: 'REDIS_URL',      value: 'rediss://${redis.name}.redis.cache.windows.net:6380' }
        { name: 'REDIS_PASSWORD', value: redis.listKeys().primaryKey }
        { name: 'REDIS_TLS',      value: 'true' }
        { name: 'JWT_SECRET',     value: jwtSecret }
        { name: 'JWT_EXPIRES_IN', value: '1h' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~18' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
      ]
      cors: {
        allowedOrigins: [ 'https://app.astorix.ai', 'https://astorix.ai' ]
        supportCredentials: true
      }
    }
  }
}

// ============================================================
// STATIC WEB APP — Frontend (app.astorix.ai)
// Free tier handles millions of requests via Azure CDN
// ============================================================
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: '${prefix}-frontend'
  location: 'westus2'  // Static Web Apps available regions
  tags: tags
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {
    repositoryUrl: 'https://github.com/sapzoker54/astorix-website'
    branch: 'main'
    buildProperties: {
      appLocation: 'frontend/civicops'
      outputLocation: ''
    }
  }
}

// ============================================================
// OUTPUTS (used by GitHub Actions deploy)
// ============================================================
output apiAppName string = apiApp.name
output apiAppHostname string = apiApp.properties.defaultHostName
output staticWebAppName string = staticWebApp.name
output dbServerFqdn string = postgresServer.properties.fullyQualifiedDomainName
output redisHostname string = '${redis.name}.redis.cache.windows.net'
