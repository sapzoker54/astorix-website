'use strict';
const { cacheGet, cacheSet } = require('../config/redis');
const { logger } = require('../utils/logger');

// Cache TTLs (seconds) — balance freshness vs API costs
const TTL = {
  LA311:      55,   // 55s — auto-refresh every 60s in UI
  USGS:       55,
  NOAA:       120,  // 2 min — weather alerts change less frequently
  HEALTH:     30,   // District health score — computed data
  NETWORK:    10,   // Network metrics — near real-time
};

// LA 311 Socrata API — City of Los Angeles open data
const LA311_BASE = 'https://data.lacity.org/resource/rq3b-xjk8.json';

// USGS Earthquake Feed
const USGS_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary';

// NOAA National Weather Service
const NOAA_BASE = 'https://api.weather.gov';

// IP Geolocation (for Signal/Signal Pro products)
const IPAPI_BASE = 'https://ipapi.co';

/**
 * Fetch with timeout + retry
 * Handles transient network errors gracefully
 */
const fetchWithRetry = async (url, options = {}, retries = 2, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return await response.json();
    } catch (err) {
      if (attempt === retries) throw err;
      logger.warn(`Fetch attempt ${attempt + 1} failed, retrying`, { url: url.substring(0, 80), error: err.message });
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
};

/**
 * LA 311 Service Requests — real-time from City of LA
 * @param {Object} options - { districts: [1..15], categories: ['Road Services','Streetlight'], limit: 1000 }
 */
const getLA311Data = async (options = {}) => {
  const { districts, categories, limit = 500 } = options;
  const cacheKey = `la311:${JSON.stringify({ districts, categories, limit })}`;

  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    let where = "status='Open'";
    if (districts && districts.length > 0) {
      const distList = districts.map(d => `'${d}'`).join(',');
      where += ` AND cd IN(${distList})`;
    }
    if (categories && categories.length > 0) {
      const catList = categories.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
      where += ` AND requesttype IN(${catList})`;
    }

    const url = `${LA311_BASE}?$where=${encodeURIComponent(where)}&$limit=${limit}&$order=createddate DESC&$select=srnumber,requesttype,status,createddate,closeddate,cd,latitude,longitude,address`;
    const raw = await fetchWithRetry(url);

    // Compute infrastructure health score (0–100)
    const totalOpen = raw.length;
    const BASELINE_OPEN = 200; // Expected baseline for a healthy district
    const healthScore = Math.max(0, Math.round(100 - (totalOpen / (BASELINE_OPEN * (districts?.length || 15))) * 100));

    // Categorize requests
    const categories_map = {};
    const INFRA_CATEGORIES = {
      'Road Services': 'roads',
      'Pothole Repair': 'roads',
      'Street Light Maintenance': 'lighting',
      'Traffic Signal Assessment': 'lighting',
      'Water Leak Investigation': 'water',
      'Sewer Emergency': 'water',
      'Sidewalk Repair': 'sidewalks',
      'Retaining Wall Inspection': 'structural',
      'Bridge Inspection': 'structural',
    };

    raw.forEach(r => {
      const cat = INFRA_CATEGORIES[r.requesttype] || 'other';
      categories_map[cat] = (categories_map[cat] || 0) + 1;
    });

    const result = {
      timestamp: new Date().toISOString(),
      source: 'LA City 311 Socrata API',
      total_open_requests: totalOpen,
      infrastructure_health_score: healthScore,
      categories: categories_map,
      recent_requests: raw.slice(0, 50), // Top 50 for UI
      district_breakdown: buildDistrictBreakdown(raw),
    };

    await cacheSet(cacheKey, result, TTL.LA311);
    return result;
  } catch (err) {
    logger.error('LA311 API error', { error: err.message });
    throw new Error(`LA 311 data unavailable: ${err.message}`);
  }
};

const buildDistrictBreakdown = (requests) => {
  const breakdown = {};
  requests.forEach(r => {
    const cd = r.cd || 'unknown';
    if (!breakdown[cd]) breakdown[cd] = { district: cd, count: 0, types: {} };
    breakdown[cd].count++;
    breakdown[cd].types[r.requesttype] = (breakdown[cd].types[r.requesttype] || 0) + 1;
  });
  return Object.values(breakdown).sort((a, b) => b.count - a.count);
};

/**
 * USGS Earthquake Feed — real-time seismic activity near LA
 * @param {number} radiusKm - Search radius (default 100km)
 * @param {number} minMagnitude - Minimum magnitude (default 1.0)
 */
const getEarthquakeData = async (radiusKm = 100, minMagnitude = 1.0) => {
  const cacheKey = `usgs:${radiusKm}:${minMagnitude}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // LA coordinates: 34.0549N, 118.2426W
    const url = `${USGS_BASE}/significant_day.geojson`;
    const fallbackUrl = `${USGS_BASE}/2.5_day.geojson`;

    let raw;
    try {
      raw = await fetchWithRetry(url);
    } catch {
      raw = await fetchWithRetry(fallbackUrl);
    }

    const LA_LAT = 34.0549, LA_LON = -118.2426;
    const events = (raw.features || [])
      .filter(f => {
        const [lon, lat] = f.geometry.coordinates;
        const dist = haversine(LA_LAT, LA_LON, lat, lon);
        return dist <= radiusKm && f.properties.mag >= minMagnitude;
      })
      .map(f => ({
        id: f.id,
        magnitude: f.properties.mag,
        place: f.properties.place,
        time: new Date(f.properties.time).toISOString(),
        depth_km: f.geometry.coordinates[2],
        distance_from_la_km: Math.round(haversine(LA_LAT, LA_LON, f.geometry.coordinates[1], f.geometry.coordinates[0])),
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        alert: f.properties.alert,
        url: f.properties.url,
      }))
      .sort((a, b) => b.magnitude - a.magnitude);

    // Seismic risk score
    const maxMag = events.length > 0 ? events[0].magnitude : 0;
    const seismicRisk = maxMag >= 5.0 ? 'HIGH' : maxMag >= 3.0 ? 'MODERATE' : maxMag >= 1.5 ? 'LOW' : 'MINIMAL';

    const result = {
      timestamp: new Date().toISOString(),
      source: 'USGS Earthquake Hazards Program',
      total_events: events.length,
      max_magnitude: maxMag,
      seismic_risk_level: seismicRisk,
      events: events.slice(0, 20),
    };

    await cacheSet(cacheKey, result, TTL.USGS);
    return result;
  } catch (err) {
    logger.error('USGS API error', { error: err.message });
    throw new Error(`Earthquake data unavailable: ${err.message}`);
  }
};

/**
 * NOAA NWS Active Alerts — California
 */
const getWeatherAlerts = async () => {
  const cacheKey = 'noaa:alerts:CA';
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${NOAA_BASE}/alerts/active?area=CA`;
    const raw = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'ASTORIX-Platform/1.0 (contact@astorix.ai)',
        'Accept': 'application/geo+json',
      }
    });

    const alerts = (raw.features || []).map(f => ({
      id: f.id,
      event: f.properties.event,
      severity: f.properties.severity,
      urgency: f.properties.urgency,
      certainty: f.properties.certainty,
      headline: f.properties.headline,
      description: f.properties.description?.substring(0, 500),
      instruction: f.properties.instruction?.substring(0, 300),
      effective: f.properties.effective,
      expires: f.properties.expires,
      areas: f.properties.areaDesc,
      status: f.properties.status,
    }));

    const result = {
      timestamp: new Date().toISOString(),
      source: 'NOAA National Weather Service',
      total_alerts: alerts.length,
      alerts,
      highest_severity: alerts.length > 0
        ? alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0].severity
        : 'None',
    };

    await cacheSet(cacheKey, result, TTL.NOAA);
    return result;
  } catch (err) {
    logger.error('NOAA API error', { error: err.message });
    throw new Error(`Weather alert data unavailable: ${err.message}`);
  }
};

const severityRank = (s) => ({ Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 }[s] || 0);

/**
 * Haversine distance formula (km)
 */
const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Combined CivicOps dashboard data — single call for efficiency
 */
const getCivicOpsDashboard = async (organizationId, options = {}) => {
  const cacheKey = `civicops:dashboard:${organizationId}:${JSON.stringify(options)}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const [la311, earthquakes, weather] = await Promise.allSettled([
    getLA311Data(options),
    getEarthquakeData(),
    getWeatherAlerts(),
  ]);

  const result = {
    timestamp: new Date().toISOString(),
    la311:       la311.status === 'fulfilled'   ? la311.value       : { error: la311.reason?.message },
    earthquakes: earthquakes.status === 'fulfilled' ? earthquakes.value : { error: earthquakes.reason?.message },
    weather:     weather.status === 'fulfilled'  ? weather.value     : { error: weather.reason?.message },
  };

  // Composite city health score
  const la311Score = result.la311?.infrastructure_health_score || 50;
  const seismicOk  = result.earthquakes?.seismic_risk_level !== 'HIGH';
  const weatherOk  = !result.weather?.alerts?.some(a => a.severity === 'Extreme' || a.severity === 'Severe');
  result.city_health_score = Math.round(la311Score * 0.6 + (seismicOk ? 25 : 5) + (weatherOk ? 15 : 0));
  result.city_status = result.city_health_score >= 80 ? 'NORMAL' : result.city_health_score >= 60 ? 'ELEVATED' : 'CRITICAL';

  await cacheSet(cacheKey, result, 30);
  return result;
};

module.exports = { getLA311Data, getEarthquakeData, getWeatherAlerts, getCivicOpsDashboard };
