const IMPORT_URL_KEYS = ['website', 'url', 'seedurl', 'seed_url', 'domain', 'homepage'];
const DASHBOARD_COMPANY_LIMIT = 500;

export function normalizeHealthStatus(value, kind = 'health') {
  const status = String(value?.status ?? value ?? 'unknown')
    .trim()
    .toLowerCase();
  if (kind === 'readiness')
    return ['ready', 'ok', 'healthy'].includes(status) ? 'ready' : status || 'unknown';
  return ['ok', 'healthy', 'ready', 'available'].includes(status) ? 'healthy' : status || 'unknown';
}

export function normalizeCapabilities(input = {}) {
  const boolean = (...keys) => {
    for (const key of keys) {
      if (typeof input[key] === 'boolean') return input[key];
    }
    return false;
  };
  const number = (key, fallback) => {
    const value = Number(input[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    ...input,
    crawl_job_api: boolean('crawl_job_api') || Boolean(input.version),
    http_crawler: boolean('http_crawler'),
    playwright_crawler: boolean('playwright_crawler'),
    outbound_middleware_delivery: boolean(
      'outbound_middleware_delivery',
      'external_delivery_enabled',
    ),
    registry_enrichment: boolean('registry_enrichment', 'registry_enrichment_enabled'),
    discovery: boolean('discovery', 'search_discovery_enabled'),
    n8n_reverse_command_inbox: boolean('n8n_reverse_command_inbox', 'durable_inbound_commands'),
    odoo_crm_projection: boolean('odoo_crm_projection', 'direct_odoo_delivery_enabled'),
    authoritative_ein_provider: boolean(
      'authoritative_ein_provider',
      'registry_provider_connected',
    ),
    keycloak_human_login: boolean('keycloak_human_login'),
    runtime_paths_verified: boolean('runtime_paths_verified'),
    production_deployed: boolean('production_deployed', 'production_deployment_verified'),
    max_companies_per_job: Math.min(
      number('max_companies_per_job', DASHBOARD_COMPANY_LIMIT),
      5_000,
    ),
    max_pages_per_job: number('max_pages_per_job', 50_000),
  };
}

export function normalizeStats(input = {}, jobs = []) {
  const jobCounts = input.jobs && typeof input.jobs === 'object' ? input.jobs : {};
  const outbox = input.outbox && typeof input.outbox === 'object' ? input.outbox : {};
  const visibleCounts = jobs.reduce((counts, job) => {
    const status = String(job.status || 'unknown');
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const count = (flatKey, nested, fallback = 0) => {
    const flat = Number(input[flatKey]);
    if (Number.isFinite(flat)) return flat;
    const nestedValue = Number(nested);
    return Number.isFinite(nestedValue) ? nestedValue : fallback;
  };
  const queued = count('jobs_queued', jobCounts.queued, visibleCounts.queued || 0);
  const running = count('jobs_running', jobCounts.running, visibleCounts.running || 0);
  const cancelling = count(
    'jobs_cancel_requested',
    jobCounts.cancel_requested,
    visibleCounts.cancel_requested || 0,
  );
  const completed = count('jobs_completed', jobCounts.completed, visibleCounts.completed || 0);
  const failed = count('jobs_failed', jobCounts.failed, visibleCounts.failed || 0);
  const cancelled = count('jobs_cancelled', jobCounts.cancelled, visibleCounts.cancelled || 0);
  return {
    ...input,
    jobs_total: count(
      'jobs_total',
      Object.values(jobCounts).reduce((sum, value) => sum + Number(value || 0), 0),
      jobs.length,
    ),
    jobs_active: count('jobs_active', queued + running + cancelling, queued + running + cancelling),
    jobs_queued: queued,
    jobs_running: running,
    jobs_cancel_requested: cancelling,
    jobs_completed: completed,
    jobs_completed_today: count('jobs_completed_today', completed, completed),
    jobs_failed: failed,
    jobs_cancelled: cancelled,
    businesses_total: count('businesses_total', input.business_entities, 0),
    businesses_resolved_today: count('businesses_resolved_today', input.business_entities, 0),
    pages_processed_today: count('pages_processed_today', input.pages_processed_today, 0),
    outbox_pending: count('outbox_pending', outbox.pending, 0),
    outbox_dead_letter: count('outbox_dead_letter', outbox.dead_letter, 0),
  };
}

export function mergeById(existing = [], incoming = []) {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) merged.set(item.id, { ...(merged.get(item.id) || {}), ...item });
  return [...merged.values()];
}

export function filterJobs(jobs = [], filters = {}) {
  const search = String(filters.search || '')
    .trim()
    .toLowerCase();
  const status = String(filters.status || '');
  const sort = String(filters.sort || 'updated-desc');
  const filtered = jobs.filter((job) => {
    if (status && job.status !== status) return false;
    if (!search) return true;
    const seeds = job.payload?.seedUrls || job.payload?.seed_urls || [];
    return [job.id, job.correlation_id, job.status, ...seeds]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(search);
  });
  return filtered.sort((left, right) => {
    if (sort === 'created-asc') return new Date(left.created_at) - new Date(right.created_at);
    if (sort === 'created-desc') return new Date(right.created_at) - new Date(left.created_at);
    if (sort === 'status') return String(left.status).localeCompare(String(right.status));
    return (
      new Date(right.updated_at || right.created_at) - new Date(left.updated_at || left.created_at)
    );
  });
}

export function filterResults(items = [], filters = {}) {
  const search = String(filters.search || '')
    .trim()
    .toLowerCase();
  const minConfidence = Math.max(0, Math.min(1, Number(filters.minConfidence || 0)));
  const contact = String(filters.contact || 'any');
  return items.filter((item) => {
    const record = item.record || {};
    const confidence = Number(record.confidence || 0);
    if (confidence < minConfidence) return false;
    const emails = Array.isArray(record.emails) ? record.emails : [];
    const phones = Array.isArray(record.phones) ? record.phones : [];
    if (contact === 'email' && emails.length === 0) return false;
    if (contact === 'phone' && phones.length === 0) return false;
    if (contact === 'missing' && (emails.length > 0 || phones.length > 0)) return false;
    if (!search) return true;
    return [
      record.legalName,
      record.displayName,
      record.domain,
      record.website,
      ...(record.categories || []),
      ...emails,
      ...phones,
      ...(record.addresses || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(search);
  });
}

export function parseLineList(value, maxItems = 50) {
  const items = String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
  const unique = [...new Set(items)];
  if (unique.length > maxItems) throw new Error(`At most ${maxItems} values are allowed.`);
  return unique;
}

export function parseTags(value) {
  const tags = {};
  for (const line of String(value || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) throw new Error(`Tag must use key=value format: ${trimmed}`);
    const key = trimmed.slice(0, separator).trim();
    const tagValue = trimmed.slice(separator + 1).trim();
    if (!key || key.length > 100) throw new Error(`Invalid tag key: ${key || '(empty)'}`);
    if (!tagValue || tagValue.length > 500) throw new Error(`Invalid value for tag ${key}`);
    tags[key] = tagValue;
  }
  return tags;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((item) => item.some((cell) => String(cell).trim()));
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeCandidateUrl(value) {
  let candidate = String(value || '').trim();
  if (!candidate) throw new Error('Website is empty.');
  if (
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) &&
    /^[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(candidate)
  ) {
    candidate = `https://${candidate}`;
  }
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only HTTP and HTTPS websites are accepted.');
  if (url.username || url.password) throw new Error('Website URLs cannot include credentials.');
  url.hash = '';
  return url.toString();
}

function objectUrl(record) {
  const entries = Object.entries(record || {}).map(([key, value]) => [normalizeHeader(key), value]);
  const map = Object.fromEntries(entries);
  for (const key of IMPORT_URL_KEYS) {
    const normalized = normalizeHeader(key);
    if (map[normalized]) return map[normalized];
  }
  return null;
}

export function parseImportText(text, options = {}) {
  const format = String(options.format || '').toLowerCase();
  const maxCompanies = Math.min(
    Number(options.maxCompanies || DASHBOARD_COMPANY_LIMIT),
    DASHBOARD_COMPANY_LIMIT,
  );
  let records;
  if (format === 'json' || (!format && /^[\s\r\n]*[\[{]/.test(String(text)))) {
    const parsed = JSON.parse(String(text || ''));
    if (Array.isArray(parsed)) records = parsed;
    else {
      const candidate = parsed.companies || parsed.targets || parsed.records || parsed.items;
      records = Array.isArray(candidate) ? candidate : [parsed];
    }
  } else {
    const rows = parseCsvRows(text);
    if (rows.length < 2)
      throw new Error('CSV must contain a header row and at least one company row.');
    const headers = rows[0].map(normalizeHeader);
    records = rows
      .slice(1)
      .map((cells) =>
        Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])),
      );
  }

  const urls = [];
  const invalid = [];
  let duplicates = 0;
  const seen = new Set();
  records.forEach((record, index) => {
    const raw = typeof record === 'string' ? record : objectUrl(record);
    try {
      if (!raw) throw new Error('No website/url column was found.');
      const url = normalizeCandidateUrl(raw);
      if (seen.has(url)) duplicates += 1;
      else {
        seen.add(url);
        urls.push(url);
      }
    } catch (error) {
      invalid.push({
        row: index + 2,
        value: String(raw || ''),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  if (urls.length > maxCompanies)
    throw new Error(
      `Import contains ${urls.length} unique websites; the dashboard limit is ${maxCompanies}.`,
    );
  if (!urls.length) throw new Error('No valid public website URLs were found in the import.');
  return { urls, totalRows: records.length, duplicates, invalid };
}

export function parseCrawlPayload(formData, options = {}) {
  const capabilities = normalizeCapabilities(options.capabilities || {});
  const imported = Array.isArray(options.importUrls) ? options.importUrls : [];
  const typed = String(formData.get('seedUrls') || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const seedUrls = [];
  const seen = new Set();
  for (const raw of [...typed, ...imported]) {
    const url = normalizeCandidateUrl(raw);
    if (!seen.has(url)) {
      seen.add(url);
      seedUrls.push(url);
    }
  }
  const serverLimit = Number(capabilities.max_companies_per_job || DASHBOARD_COMPANY_LIMIT);
  const safeCompanyLimit = Math.min(DASHBOARD_COMPANY_LIMIT, serverLimit);
  if (!seedUrls.length) throw new Error('Add at least one public HTTP or HTTPS seed URL.');
  if (seedUrls.length > safeCompanyLimit)
    throw new Error(`At most ${safeCompanyLimit} seed URLs are allowed.`);

  const number = (name) => Number(formData.get(name));
  const payload = {
    seedUrls,
    profile: String(formData.get('profile') || 'full'),
    mode: String(formData.get('mode') || 'domain'),
    browser: String(formData.get('browser') || 'auto'),
    maxPages: number('maxPages'),
    maxCompanies: number('maxCompanies'),
    maxDepth: number('maxDepth'),
    requestsPerSecond: number('requestsPerSecond'),
    countryCode: String(formData.get('countryCode') || 'US')
      .trim()
      .toUpperCase(),
  };
  if (
    !Number.isInteger(payload.maxPages) ||
    payload.maxPages < 1 ||
    payload.maxPages > capabilities.max_pages_per_job
  ) {
    throw new Error(
      `Max pages must be between 1 and ${capabilities.max_pages_per_job.toLocaleString()}.`,
    );
  }
  if (
    !Number.isInteger(payload.maxCompanies) ||
    payload.maxCompanies < 1 ||
    payload.maxCompanies > safeCompanyLimit
  ) {
    throw new Error(`Max companies must be between 1 and ${safeCompanyLimit}.`);
  }
  if (seedUrls.length > payload.maxCompanies)
    throw new Error('Seed URL count cannot exceed the max-company limit.');
  if (!Number.isInteger(payload.maxDepth) || payload.maxDepth < 0 || payload.maxDepth > 8)
    throw new Error('Max depth must be between 0 and 8.');
  if (
    !Number.isFinite(payload.requestsPerSecond) ||
    payload.requestsPerSecond < 0.1 ||
    payload.requestsPerSecond > 10
  ) {
    throw new Error('Requests per second must be between 0.1 and 10.');
  }
  if (!/^[A-Z]{2}$/.test(payload.countryCode))
    throw new Error('Country code must contain exactly two letters.');
  if (payload.profile === 'registry' && !capabilities.registry_enrichment)
    throw new Error('Registry enrichment is not available in this API context.');
  if (payload.mode === 'discovery' && !capabilities.discovery)
    throw new Error('Search discovery is not available in this API context.');

  const includePatterns = parseLineList(formData.get('includePatterns'));
  const excludePatterns = parseLineList(formData.get('excludePatterns'));
  const tags = parseTags(formData.get('tags'));
  const callbackReference = String(formData.get('callbackReference') || '').trim();
  if (includePatterns.length) payload.includePatterns = includePatterns;
  if (excludePatterns.length) payload.excludePatterns = excludePatterns;
  if (Object.keys(tags).length) payload.tags = tags;
  if (callbackReference) payload.callbackReference = callbackReference;
  return payload;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function resultsToCsv(items = []) {
  const headers = [
    'id',
    'display_name',
    'legal_name',
    'domain',
    'website',
    'confidence',
    'emails',
    'phones',
    'addresses',
    'categories',
    'first_seen_at',
    'last_seen_at',
  ];
  const rows = items.map((item) => {
    const record = item.record || {};
    return [
      item.id,
      record.displayName,
      record.legalName,
      record.domain,
      record.website,
      record.confidence,
      (record.emails || []).join('; '),
      (record.phones || []).join('; '),
      (record.addresses || []).join('; '),
      (record.categories || []).join('; '),
      record.firstSeenAt,
      record.lastSeenAt,
    ];
  });
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export function safeFilePart(value) {
  return (
    String(value || 'view')
      .replace(/[^a-z0-9_.-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'view'
  );
}
