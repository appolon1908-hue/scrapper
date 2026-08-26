import fs from 'node:fs';

function integer(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`invalid_environment:${name}`);
  }
  return value;
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`invalid_environment:${name}`);
}

function list(name, fallback = []) {
  const value = process.env[name];
  return value
    ? value
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    : fallback;
}

export function secret(fileName, directName) {
  const path = process.env[fileName];
  if (path) return fs.readFileSync(path, 'utf8').trim();
  return (process.env[directName] || '').trim();
}

function requireWhen(enabled, names) {
  if (!enabled) return;
  for (const name of names) {
    if (!process.env[name] && !process.env[`${name}_FILE`]) {
      throw new Error(`required_environment_missing:${name}`);
    }
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';
const role = process.env.ENTERPRISE_ROLE || 'api';
if (!['api', 'target-worker', 'discovery-worker', 'delivery-worker', 'privacy-worker', 'all'].includes(role)) {
  throw new Error('invalid_environment:ENTERPRISE_ROLE');
}

const discoveryEnabled = bool('ENABLE_SEARCH_DISCOVERY', false);
const einVerificationEnabled = bool('ENABLE_AUTHORITATIVE_EIN_VERIFICATION', false);
const directOdooEnabled = bool('ENABLE_DIRECT_ODOO', false);

requireWhen(discoveryEnabled, ['SEARCH_PROVIDER', 'SEARCH_API_KEY']);
requireWhen(einVerificationEnabled, ['EIN_PROVIDER_URL', 'EIN_PROVIDER_TOKEN']);
requireWhen(directOdooEnabled, ['ODOO_URL', 'ODOO_DATABASE', 'ODOO_USERNAME', 'ODOO_API_KEY']);

export const config = Object.freeze({
  nodeEnv,
  role,
  port: integer('ENTERPRISE_PORT', 3300, 1, 65535),
  databaseUrl:
    secret('DATABASE_URL_FILE', 'DATABASE_URL') ||
    'postgresql://scrapper:scrapper@localhost:5432/scrapper',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  coreApiUrl: (process.env.SCRAPPER_CORE_URL || 'http://api:3000').replace(/\/$/, ''),
  coreApiToken: secret('SCRAPPER_CORE_TOKEN_FILE', 'SCRAPPER_CORE_TOKEN'),
  coreApiPollSeconds: integer('SCRAPPER_CORE_POLL_SECONDS', 3, 1, 60),
  coreApiTimeoutSeconds: integer('SCRAPPER_CORE_TIMEOUT_SECONDS', 3600, 60, 21600),
  maxCompaniesPerJob: integer('MAX_COMPANIES_PER_JOB', 500, 1, 500),
  maxImportBytes: integer('MAX_IMPORT_BYTES', 10_000_000, 10_000, 50_000_000),
  targetConcurrency: integer('TARGET_WORKER_CONCURRENCY', 8, 1, 100),
  discoveryConcurrency: integer('DISCOVERY_WORKER_CONCURRENCY', 2, 1, 20),
  deliveryConcurrency: integer('DELIVERY_WORKER_CONCURRENCY', 4, 1, 50),
  privacyConcurrency: integer('PRIVACY_WORKER_CONCURRENCY', 1, 1, 10),
  leaseSeconds: integer('ENTERPRISE_LEASE_SECONDS', 120, 30, 1800),
  maxTargetAttempts: integer('MAX_TARGET_ATTEMPTS', 4, 1, 20),
  tenantClaim: process.env.KEYCLOAK_TENANT_CLAIM || 'tenant_id',
  keycloakIssuer: (process.env.KEYCLOAK_ISSUER || 'https://auth.codestra.co/realms/codestra').replace(/\/$/, ''),
  keycloakAudience: process.env.KEYCLOAK_AUDIENCE || 'codestra-scrapper-admin',
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID || 'codestra-scrapper-admin',
  keycloakClientSecret: secret('KEYCLOAK_CLIENT_SECRET_FILE', 'KEYCLOAK_CLIENT_SECRET'),
  keycloakRedirectUri: process.env.KEYCLOAK_REDIRECT_URI || '',
  sessionEncryptionKey: secret('SESSION_ENCRYPTION_KEY_FILE', 'SESSION_ENCRYPTION_KEY'),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || '__Host-scrapper_session',
  sessionHours: integer('SESSION_HOURS', 8, 1, 24),
  n8nHmacSecret: secret('N8N_INBOUND_HMAC_SECRET_FILE', 'N8N_INBOUND_HMAC_SECRET'),
  n8nMaxSkewSeconds: integer('N8N_MAX_SKEW_SECONDS', 300, 30, 1800),
  discoveryEnabled,
  searchProvider: (process.env.SEARCH_PROVIDER || 'disabled').toLowerCase(),
  searchApiKey: secret('SEARCH_API_KEY_FILE', 'SEARCH_API_KEY'),
  searchEndpoint: process.env.SEARCH_ENDPOINT || '',
  googleSearchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID || '',
  searchAllowedCountries: list('SEARCH_ALLOWED_COUNTRIES', ['us']),
  searchBlockedHosts: list('SEARCH_BLOCKED_HOSTS', [
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'x.com',
    'twitter.com',
    'youtube.com',
    'yelp.com',
    'yellowpages.com',
  ]),
  einVerificationEnabled,
  einProviderUrl: process.env.EIN_PROVIDER_URL || '',
  einProviderToken: secret('EIN_PROVIDER_TOKEN_FILE', 'EIN_PROVIDER_TOKEN'),
  einFingerprintPepper: secret('EIN_FINGERPRINT_PEPPER_FILE', 'EIN_FINGERPRINT_PEPPER'),
  einProviderCaFile: process.env.EIN_PROVIDER_CA_FILE || '',
  einProviderClientCertFile: process.env.EIN_PROVIDER_CLIENT_CERT_FILE || '',
  einProviderClientKeyFile: process.env.EIN_PROVIDER_CLIENT_KEY_FILE || '',
  directOdooEnabled,
  odooUrl: (process.env.ODOO_URL || '').replace(/\/$/, ''),
  odooDatabase: process.env.ODOO_DATABASE || '',
  odooUsername: process.env.ODOO_USERNAME || '',
  odooApiKey: secret('ODOO_API_KEY_FILE', 'ODOO_API_KEY'),
  odooExternalIdField: process.env.ODOO_EXTERNAL_ID_FIELD || 'x_scrapper_external_id',
  odooTeamId: process.env.ODOO_TEAM_ID ? Number(process.env.ODOO_TEAM_ID) : null,
  odooUserId: process.env.ODOO_USER_ID ? Number(process.env.ODOO_USER_ID) : null,
  odooCaFile: process.env.ODOO_CA_FILE || '',
  odooClientCertFile: process.env.ODOO_CLIENT_CERT_FILE || '',
  odooClientKeyFile: process.env.ODOO_CLIENT_KEY_FILE || '',
});

if (nodeEnv === 'production') {
  if (!config.coreApiToken) throw new Error('SCRAPPER_CORE_TOKEN is required in production');
  if (!config.einFingerprintPepper) throw new Error('EIN_FINGERPRINT_PEPPER is required in production');
  if (!config.sessionEncryptionKey) throw new Error('SESSION_ENCRYPTION_KEY is required in production');
}
