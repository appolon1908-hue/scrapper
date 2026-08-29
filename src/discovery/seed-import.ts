import crypto from 'node:crypto';
import { z } from 'zod';
import { log } from '../log.js';
import { cleanCsvHeader, parseCsvSeedRows } from './csv-adapter.js';

const FlexibleScalarSchema = z.union([z.string(), z.number(), z.null()]).optional();
const RawSeedSchema = z
  .object({
    _row: z.coerce.number().int().positive().optional(),
    website: FlexibleScalarSchema,
    url: FlexibleScalarSchema,
    domain: FlexibleScalarSchema,
    business_name: FlexibleScalarSchema,
    businessName: FlexibleScalarSchema,
    name: FlexibleScalarSchema,
    known_email: FlexibleScalarSchema,
    knownEmail: FlexibleScalarSchema,
    email: FlexibleScalarSchema,
    known_phone: FlexibleScalarSchema,
    knownPhone: FlexibleScalarSchema,
    phone: FlexibleScalarSchema,
    known_owner: FlexibleScalarSchema,
    knownOwner: FlexibleScalarSchema,
    owner: FlexibleScalarSchema,
    country_code: FlexibleScalarSchema,
    countryCode: FlexibleScalarSchema,
    external_reference: FlexibleScalarSchema,
    externalReference: FlexibleScalarSchema,
    external_id: FlexibleScalarSchema,
    tags: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());

const ValidatedSeedSchema = z.object({
  businessName: z.string().max(300).nullable(),
  website: z.string().url(),
  normalizedDomain: z.string().min(1).max(253),
  knownEmail: z.string().email().max(254).nullable(),
  knownPhone: z
    .string()
    .regex(/^\+?\d{7,15}$/)
    .nullable(),
  knownOwner: z.string().max(300).nullable(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  externalReference: z.string().max(300).nullable(),
  tags: z.record(z.string().max(100), z.string().max(500)),
  sourceRow: z.number().int().positive(),
});

const ImportOptionsSchema = z.object({
  maxCompanies: z.number().int().min(1).max(100_000).default(500),
});

const ParseImportSchema = z.object({
  format: z.enum(['csv', 'json']),
  content: z.unknown(),
  maxCompanies: z.number().int().min(1).max(100_000).default(500),
});

const DiscoveryResultSchema = z.object({
  title: z.string().max(2_000).optional().default(''),
  url: z.string().max(10_000),
  snippet: z.string().max(10_000).optional().default(''),
});

const DiscoveryImportSchema = z.object({
  results: z.array(DiscoveryResultSchema).max(10_000),
  provider: z.string().trim().min(1).max(100),
  query: z.string().trim().min(1).max(1_000),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .default('US'),
  maxCompanies: z.number().int().min(1).max(500).default(500),
  blockedHosts: z
    .array(z.string().trim().toLowerCase().min(1).max(253))
    .max(1_000)
    .default(['facebook.com', 'linkedin.com', 'yelp.com']),
});

export type RawSeed = z.infer<typeof RawSeedSchema>;
export type ValidatedSeed = z.infer<typeof ValidatedSeedSchema>;

export type SeedImportError = {
  row: number;
  code: string;
  value?: string;
};

export type SeedValidationResult = {
  companies: ValidatedSeed[];
  errors: SeedImportError[];
  summary: {
    input: number;
    accepted: number;
    rejected: number;
    digest: string;
  };
};

function text(...values: unknown[]): string {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null);
  return String(value ?? '').trim();
}

function normalizeWebsite(raw: unknown): string {
  let value = text(raw);
  if (!value) throw new Error('website_required');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid_website');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('website_http_required');
  if (url.username || url.password) throw new Error('website_credentials_forbidden');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('website_port_forbidden');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid']) {
    url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

function domainOf(website: string): string {
  return new URL(website).hostname.toLowerCase().replace(/^www\./, '');
}

function normalizeEmail(value: unknown): string | null {
  const email = text(value).toLowerCase();
  if (!email) return null;
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)
  ) {
    throw new Error('invalid_email');
  }
  return email;
}

function normalizePhone(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const prefix = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw new Error('invalid_phone');
  return `${prefix}${digits}`;
}

function normalizeTags(value: unknown): Record<string, string> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) return {};
  const tags: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed.data)) {
    const normalizedKey = cleanCsvHeader(key).slice(0, 100);
    if (normalizedKey) tags[normalizedKey] = String(item ?? '').slice(0, 500);
  }
  return tags;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'invalid_company';
}

export function parseJsonSeedRows(content: unknown): RawSeed[] {
  let parsed: unknown;
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : content;
  } catch {
    throw new Error('invalid_json_import');
  }

  const container = z
    .union([
      z.array(z.unknown()),
      z.object({ companies: z.array(z.unknown()) }),
      z.object({ items: z.array(z.unknown()) }),
    ])
    .safeParse(parsed);
  if (!container.success) throw new Error('json_companies_array_required');

  const rows = Array.isArray(container.data)
    ? container.data
    : 'companies' in container.data
      ? container.data.companies
      : container.data.items;
  return rows.map((item, index) =>
    RawSeedSchema.parse({
      ...(z.record(z.string(), z.unknown()).parse(item) as Record<string, unknown>),
      _row: index + 1,
    }),
  );
}

export function validateSeedRecords(
  input: unknown,
  options: { maxCompanies?: number } = {},
): SeedValidationResult {
  if (!Array.isArray(input)) throw new Error('companies_array_required');
  if (input.length === 0) throw new Error('companies_required');
  const { maxCompanies } = ImportOptionsSchema.parse(options);
  if (input.length > maxCompanies) throw new Error('company_limit_exceeded');

  const companies: ValidatedSeed[] = [];
  const errors: SeedImportError[] = [];
  const seenDomains = new Set<string>();

  input.forEach((candidate, index) => {
    const parsed = RawSeedSchema.safeParse(candidate);
    const sourceRow = parsed.success ? (parsed.data._row ?? index + 1) : index + 1;
    if (!parsed.success) {
      errors.push({ row: sourceRow, code: 'invalid_company' });
      return;
    }

    try {
      const raw = parsed.data;
      const website = normalizeWebsite(text(raw.website, raw.url, raw.domain));
      const normalizedDomain = domainOf(website);
      if (seenDomains.has(normalizedDomain)) {
        errors.push({ row: sourceRow, code: 'duplicate_domain', value: normalizedDomain });
        return;
      }
      seenDomains.add(normalizedDomain);
      const countryCode = text(raw.country_code, raw.countryCode, 'US').toUpperCase();
      if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('invalid_country_code');

      companies.push(
        ValidatedSeedSchema.parse({
          businessName: text(raw.business_name, raw.businessName, raw.name).slice(0, 300) || null,
          website,
          normalizedDomain,
          knownEmail: normalizeEmail(text(raw.known_email, raw.knownEmail, raw.email)),
          knownPhone: normalizePhone(text(raw.known_phone, raw.knownPhone, raw.phone)),
          knownOwner: text(raw.known_owner, raw.knownOwner, raw.owner).slice(0, 300) || null,
          countryCode,
          externalReference:
            text(raw.external_reference, raw.externalReference, raw.external_id).slice(0, 300) ||
            null,
          tags: normalizeTags(raw.tags),
          sourceRow,
        }),
      );
    } catch (error) {
      errors.push({ row: sourceRow, code: errorCode(error) });
    }
  });

  const digest = crypto.createHash('sha256').update(JSON.stringify(companies)).digest('hex');
  return {
    companies,
    errors,
    summary: {
      input: input.length,
      accepted: companies.length,
      rejected: errors.length,
      digest,
    },
  };
}

export function parseAndValidateSeedImport(input: unknown): SeedValidationResult & {
  bytes: number;
  format: 'csv' | 'json';
} {
  const parsedInput = ParseImportSchema.parse(input);
  const bytes = Buffer.byteLength(
    typeof parsedInput.content === 'string'
      ? parsedInput.content
      : JSON.stringify(parsedInput.content),
  );
  const rows =
    parsedInput.format === 'csv'
      ? parseCsvSeedRows(parsedInput.content)
      : parseJsonSeedRows(parsedInput.content);
  const result = validateSeedRecords(rows, { maxCompanies: parsedInput.maxCompanies });
  log('info', 'seed_import_validated', {
    format: parsedInput.format,
    bytes,
    input: result.summary.input,
    accepted: result.summary.accepted,
    rejected: result.summary.rejected,
    digest: result.summary.digest,
  });
  return { ...result, bytes, format: parsedInput.format };
}

export function buildDiscoveryQuery(input: {
  query: string;
  location?: string;
  industry?: string;
  countryCode?: string;
}): string {
  return [
    input.query,
    input.industry,
    input.location,
    input.countryCode,
    '-site:facebook.com',
    '-site:linkedin.com',
    '-site:yelp.com',
  ]
    .filter(Boolean)
    .join(' ');
}

function officialCandidate(rawUrl: string, blockedHosts: string[]): string | null {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (blockedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
      return null;
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    url.pathname = '/';
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function importDiscoveryResults(input: unknown): SeedValidationResult & {
  provider: string;
  rawResultCount: number;
} {
  const parsed = DiscoveryImportSchema.parse(input);
  const candidates: RawSeed[] = [];
  const seen = new Set<string>();

  for (const result of parsed.results) {
    const website = officialCandidate(result.url, parsed.blockedHosts);
    if (!website) continue;
    const domain = domainOf(website);
    if (seen.has(domain)) continue;
    seen.add(domain);
    candidates.push({
      business_name: result.title.replace(/\s+[|–—-].*$/, '').slice(0, 300),
      website,
      country_code: parsed.countryCode,
      external_reference: `search:${parsed.provider.toLowerCase()}:${domain}`,
      tags: {
        discovery_provider: parsed.provider.toLowerCase(),
        discovery_query: parsed.query,
        discovery_snippet: result.snippet.slice(0, 500),
      },
      _row: candidates.length + 1,
    });
    if (candidates.length >= parsed.maxCompanies) break;
  }

  if (candidates.length === 0) throw new Error('companies_required');
  const result = validateSeedRecords(candidates, { maxCompanies: parsed.maxCompanies });
  log('info', 'discovery_results_validated', {
    provider: parsed.provider.toLowerCase(),
    rawResultCount: parsed.results.length,
    accepted: result.summary.accepted,
    rejected: result.summary.rejected,
    digest: result.summary.digest,
  });
  return {
    ...result,
    provider: parsed.provider.toLowerCase(),
    rawResultCount: parsed.results.length,
  };
}

export const parseJsonCompanies = parseJsonSeedRows;
export const validateCompanies = validateSeedRecords;
export const parseAndValidateImport = parseAndValidateSeedImport;
