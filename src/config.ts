import fs from 'node:fs';

export type RuntimeRole = 'api' | 'crawl-worker' | 'delivery-worker' | 'all';

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`invalid_environment:${name}`);
  }
  return value;
}

function decimal(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`invalid_environment:${name}`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`invalid_environment:${name}`);
}

function list(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function readSecret(fileEnv: string, directEnv: string): string {
  const file = process.env[fileEnv];
  if (file) return fs.readFileSync(file, 'utf8').trim();
  return (process.env[directEnv] || '').trim();
}

const role = (process.env.ROLE || 'all') as RuntimeRole;
if (!['api', 'crawl-worker', 'delivery-worker', 'all'].includes(role)) {
  throw new Error('invalid_environment:ROLE');
}

const nodeEnv = process.env.NODE_ENV || 'development';
const externalDeliveryEnabled = bool('ENABLE_EXTERNAL_DELIVERY', false);
const servicePrincipalsFile = process.env.SERVICE_PRINCIPALS_FILE || '';

if (nodeEnv === 'production' && !servicePrincipalsFile) {
  throw new Error('SERVICE_PRINCIPALS_FILE is required in production');
}

if (nodeEnv === 'production' && externalDeliveryEnabled) {
  const required = [
    'MIDDLEWARE_BASE_URL',
    'OUTBOUND_HMAC_SECRET_FILE',
    'OUTBOUND_BEARER_TOKEN_FILE',
    'OUTBOUND_CA_FILE',
    'OUTBOUND_CLIENT_CERT_FILE',
    'OUTBOUND_CLIENT_KEY_FILE',
  ];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`${name} is required for production delivery`);
  }
}

export const config = Object.freeze({
  nodeEnv,
  role,
  port: integer('PORT', 3000, 1, 65535),
  databaseUrl:
    readSecret('DATABASE_URL_FILE', 'DATABASE_URL') ||
    'postgresql://scrapper:scrapper@localhost:5432/scrapper',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  servicePrincipalsFile,
  scraperUserAgent:
    process.env.SCRAPER_USER_AGENT ||
    'CodestraBusinessCrawler/2.0 (+https://codestra.co/crawler-policy)',
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || 'US').toUpperCase(),
  maxJobCompanies: integer('MAX_JOB_COMPANIES', 500, 1, 5000),
  maxJobPages: integer('MAX_JOB_PAGES', 5000, 1, 50000),
  maxJobRuntimeSeconds: integer('MAX_JOB_RUNTIME_SECONDS', 7200, 60, 86400),
  httpConcurrency: integer('HTTP_CONCURRENCY', 12, 1, 100),
  browserConcurrency: integer('BROWSER_CONCURRENCY', 2, 1, 20),
  jobConcurrency: integer('JOB_CONCURRENCY', 2, 1, 20),
  perHostRequestsPerSecond: decimal('PER_HOST_REQUESTS_PER_SECOND', 1, 0.1, 10),
  middlewareBaseUrl: (process.env.MIDDLEWARE_BASE_URL || '').replace(/\/$/, ''),
  middlewareResultsPath: process.env.MIDDLEWARE_RESULTS_PATH || '/api/v2/scraper/results/batches',
  middlewareEventsPath: process.env.MIDDLEWARE_EVENTS_PATH || '/api/v2/scraper/jobs/events',
  outboundAllowedHosts: list('OUTBOUND_ALLOWED_HOSTS'),
  outboundHmacSecret: readSecret('OUTBOUND_HMAC_SECRET_FILE', 'OUTBOUND_HMAC_SECRET'),
  outboundBearerToken: readSecret('OUTBOUND_BEARER_TOKEN_FILE', 'OUTBOUND_BEARER_TOKEN'),
  outboundCaFile: process.env.OUTBOUND_CA_FILE || '',
  outboundClientCertFile: process.env.OUTBOUND_CLIENT_CERT_FILE || '',
  outboundClientKeyFile: process.env.OUTBOUND_CLIENT_KEY_FILE || '',
  einFingerprintPepper: readSecret('EIN_FINGERPRINT_PEPPER_FILE', 'EIN_FINGERPRINT_PEPPER'),
  dataRetentionDays: integer('DATA_RETENTION_DAYS', 30, 1, 3650),
  rawPageRetentionDays: integer('RAW_PAGE_RETENTION_DAYS', 7, 0, 90),
  deliveryBatchSize: integer('DELIVERY_BATCH_SIZE', 100, 1, 500),
  deliveryMaxAttempts: integer('DELIVERY_MAX_ATTEMPTS', 12, 1, 50),
  externalDeliveryEnabled,
  registryEnrichmentEnabled: bool('ENABLE_REGISTRY_ENRICHMENT', false),
});
