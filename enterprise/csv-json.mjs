import crypto from 'node:crypto';

const HEADER_ALIASES = new Map([
  ['company', 'business_name'],
  ['company_name', 'business_name'],
  ['business', 'business_name'],
  ['business_name', 'business_name'],
  ['name', 'business_name'],
  ['url', 'website'],
  ['domain', 'website'],
  ['website', 'website'],
  ['email', 'known_email'],
  ['business_email', 'known_email'],
  ['known_email', 'known_email'],
  ['phone', 'known_phone'],
  ['telephone', 'known_phone'],
  ['known_phone', 'known_phone'],
  ['owner', 'known_owner'],
  ['owner_name', 'known_owner'],
  ['known_owner', 'known_owner'],
  ['country', 'country_code'],
  ['country_code', 'country_code'],
  ['external_id', 'external_reference'],
  ['external_reference', 'external_reference'],
  ['reference', 'external_reference'],
]);

function cleanHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseCsv(content) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const text = String(content || '').replace(/^\uFEFF/, '');

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      if (row.some((entry) => entry.trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (quoted) throw new Error('csv_unclosed_quote');
  row.push(value.replace(/\r$/, ''));
  if (row.some((entry) => entry.trim())) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0].map((header) => {
    const normalized = cleanHeader(header);
    return HEADER_ALIASES.get(normalized) || normalized;
  });
  if (!headers.includes('website')) throw new Error('import_website_column_required');

  return rows.slice(1).map((columns, rowIndex) => {
    const item = { _row: rowIndex + 2 };
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      const cell = String(columns[columnIndex] || '').trim();
      if (header.startsWith('tag_')) {
        item.tags ||= {};
        item.tags[header.slice(4)] = cell;
      } else {
        item[header] = cell;
      }
    });
    return item;
  });
}

export function parseJsonCompanies(content) {
  let parsed;
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : content;
  } catch {
    throw new Error('invalid_json_import');
  }
  const companies = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.companies)
      ? parsed.companies
      : Array.isArray(parsed?.items)
        ? parsed.items
        : null;
  if (!companies) throw new Error('json_companies_array_required');
  return companies.map((item, index) => ({ ...item, _row: index + 1 }));
}

function normalizeWebsite(raw) {
  let value = String(raw || '').trim();
  if (!value) throw new Error('website_required');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('website_http_required');
  if (url.username || url.password) throw new Error('website_credentials_forbidden');
  if (![80, 443, ''].includes(url.port && Number(url.port))) throw new Error('website_port_forbidden');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid']) {
    url.searchParams.delete(key);
  }
  return url.toString();
}

function domainOf(website) {
  return new URL(website).hostname.toLowerCase().replace(/^www\./, '');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
    throw new Error('invalid_email');
  }
  return email;
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const prefix = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw new Error('invalid_phone');
  return `${prefix}${digits}`;
}

function tagsOf(item) {
  const result = {};
  if (item.tags && typeof item.tags === 'object' && !Array.isArray(item.tags)) {
    for (const [key, value] of Object.entries(item.tags)) {
      const normalizedKey = cleanHeader(key).slice(0, 100);
      if (normalizedKey) result[normalizedKey] = String(value ?? '').slice(0, 500);
    }
  }
  return result;
}

export function validateCompanies(input, { maxCompanies = 500 } = {}) {
  if (!Array.isArray(input)) throw new Error('companies_array_required');
  if (!input.length) throw new Error('companies_required');
  if (input.length > maxCompanies) throw new Error('company_limit_exceeded');

  const companies = [];
  const errors = [];
  const seenDomains = new Set();

  for (const [index, raw] of input.entries()) {
    const sourceRow = Number(raw?._row || index + 1);
    try {
      const website = normalizeWebsite(raw.website || raw.url || raw.domain);
      const normalizedDomain = domainOf(website);
      if (seenDomains.has(normalizedDomain)) {
        errors.push({ row: sourceRow, code: 'duplicate_domain', value: normalizedDomain });
        continue;
      }
      seenDomains.add(normalizedDomain);
      const countryCode = String(raw.country_code || raw.countryCode || 'US').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('invalid_country_code');
      companies.push({
        businessName: String(raw.business_name || raw.businessName || raw.name || '').trim().slice(0, 300) || null,
        website,
        normalizedDomain,
        knownEmail: normalizeEmail(raw.known_email || raw.knownEmail || raw.email),
        knownPhone: normalizePhone(raw.known_phone || raw.knownPhone || raw.phone),
        knownOwner: String(raw.known_owner || raw.knownOwner || raw.owner || '').trim().slice(0, 300) || null,
        countryCode,
        externalReference:
          String(raw.external_reference || raw.externalReference || raw.external_id || '').trim().slice(0, 300) || null,
        tags: tagsOf(raw),
        sourceRow,
      });
    } catch (error) {
      errors.push({
        row: sourceRow,
        code: error instanceof Error ? error.message : 'invalid_company',
      });
    }
  }

  return {
    companies,
    errors,
    summary: {
      input: input.length,
      accepted: companies.length,
      rejected: errors.length,
      digest: crypto.createHash('sha256').update(JSON.stringify(companies)).digest('hex'),
    },
  };
}

export function parseAndValidateImport({ format, content, maxCompanies = 500 }) {
  if (!['csv', 'json'].includes(format)) throw new Error('unsupported_import_format');
  const bytes = Buffer.byteLength(typeof content === 'string' ? content : JSON.stringify(content));
  const parsed = format === 'csv' ? parseCsv(content) : parseJsonCompanies(content);
  return { ...validateCompanies(parsed, { maxCompanies }), bytes, format };
}
