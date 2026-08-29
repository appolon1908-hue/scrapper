const now = Date.now();
const minute = 60_000;
const hour = 60 * minute;

function job(index, overrides = {}) {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const status = overrides.status || 'completed';
  const createdAt = new Date(now - index * 42 * minute).toISOString();
  const pagesProcessed = overrides.pagesProcessed ?? Math.max(2, 48 - index * 2);
  const companiesResolved = overrides.companiesResolved ?? Math.max(1, 18 - index);

  return {
    id,
    tenant_id: 'tenant-codestra-demo',
    correlation_id: `demo-${index}`,
    status,
    progress: {
      pagesProcessed,
      pagesFailed: index % 4,
      pagesDeniedByRobots: index % 3,
      browserFallbacks: index % 2,
      companiesResolved,
      startedAt: new Date(now - index * 42 * minute + 2 * minute).toISOString(),
    },
    payload: {
      seedUrls: [`https://${overrides.domain || `business-${index}.example.com`}/`],
      profile: overrides.profile || 'full',
      browser: overrides.browser || 'auto',
      maxPages: overrides.maxPages || 50,
      maxCompanies: overrides.maxCompanies || 25,
      maxDepth: 3,
      countryCode: overrides.countryCode || 'US',
      requestsPerSecond: 1,
    },
    error:
      status === 'failed'
        ? {
            code: 'crawl_timeout',
            message: 'The source exceeded the bounded runtime window.',
          }
        : null,
    version: index + 2,
    created_at: createdAt,
    updated_at: new Date(now - index * 38 * minute).toISOString(),
    started_at: status === 'queued' ? null : new Date(now - index * 40 * minute).toISOString(),
    completed_at: ['completed', 'failed', 'cancelled'].includes(status)
      ? new Date(now - index * 35 * minute).toISOString()
      : null,
  };
}

export const demoJobs = [
  job(1, {
    status: 'running',
    domain: 'northstar-logistics.com',
    pagesProcessed: 31,
    companiesResolved: 14,
    maxPages: 80,
    maxCompanies: 40,
  }),
  job(2, {
    status: 'queued',
    domain: 'medical-suppliers.example',
    pagesProcessed: 0,
    companiesResolved: 0,
  }),
  job(3, { status: 'completed', domain: 'atlas-financial.example' }),
  job(4, { status: 'completed', domain: 'caribbean-hotels.example', countryCode: 'DO' }),
  job(5, { status: 'failed', domain: 'regional-construction.example' }),
  job(6, { status: 'completed', domain: 'greenfield-agriculture.example' }),
  job(7, { status: 'cancel_requested', domain: 'metro-retail.example' }),
  job(8, { status: 'completed', domain: 'summit-legal.example' }),
  job(9, { status: 'cancelled', domain: 'legacy-directory.example' }),
  job(10, { status: 'completed', domain: 'harbor-manufacturing.example' }),
  job(11, { status: 'completed', domain: 'cloud-saas.example' }),
  job(12, { status: 'completed', domain: 'city-education.example' }),
];

export const demoResults = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    record: {
      displayName: 'Northstar Logistics Group',
      domain: 'northstar-logistics.com',
      confidence: 0.96,
      phones: ['+1 617 555 0180'],
      emails: ['operations@northstar-logistics.com'],
      addresses: ['Boston, Massachusetts, United States'],
      categories: ['Logistics', 'Freight brokerage'],
      firstSeenAt: new Date(now - 4 * hour).toISOString(),
      lastSeenAt: new Date(now - 8 * minute).toISOString(),
    },
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    record: {
      displayName: 'Northstar Warehousing',
      domain: 'warehouse.northstar-logistics.com',
      confidence: 0.89,
      phones: ['+1 617 555 0124'],
      emails: ['warehouse@northstar-logistics.com'],
      addresses: ['Worcester, Massachusetts, United States'],
      categories: ['Warehousing', 'Distribution'],
      firstSeenAt: new Date(now - 3 * hour).toISOString(),
      lastSeenAt: new Date(now - 11 * minute).toISOString(),
    },
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    record: {
      displayName: 'Northstar Fleet Services',
      domain: 'fleet.northstar-logistics.com',
      confidence: 0.83,
      phones: [],
      emails: ['fleet@northstar-logistics.com'],
      addresses: ['Providence, Rhode Island, United States'],
      categories: ['Fleet management'],
      firstSeenAt: new Date(now - 2 * hour).toISOString(),
      lastSeenAt: new Date(now - 18 * minute).toISOString(),
    },
  },
];

export const demoStats = {
  jobs_total: 284,
  jobs_active: 2,
  jobs_completed_today: 37,
  businesses_total: 12_480,
  businesses_resolved_today: 1_246,
  outbox_pending: 18,
  outbox_dead_letter: 3,
  pages_processed_today: 8_742,
};

export const demoCapabilities = {
  crawl_job_api: true,
  http_crawler: true,
  playwright_crawler: true,
  outbound_middleware_delivery: false,
  registry_enrichment: false,
  n8n_reverse_command_inbox: false,
  odoo_crm_projection: false,
  authoritative_ein_provider: false,
  runtime_paths_verified: false,
  production_deployed: false,
};

export const demoReviews = [
  {
    id: 'RVW-1042',
    company: 'Northstar Logistics Group',
    reason: 'Two domains may represent one legal entity',
    confidence: 0.72,
    age: '12 min',
  },
  {
    id: 'RVW-1039',
    company: 'Atlas Financial Services',
    reason: 'Phone number conflicts with prior evidence',
    confidence: 0.64,
    age: '41 min',
  },
  {
    id: 'RVW-1032',
    company: 'Caribbean Hotels Network',
    reason: 'Manual country normalization required',
    confidence: 0.78,
    age: '2 hr',
  },
];

export const demoDeliveries = [
  {
    destination: 'Middleware event inbox',
    status: 'disabled',
    pending: 18,
    deadLetter: 3,
    note: 'External delivery is intentionally disabled.',
  },
  {
    destination: 'Odoo CRM projection',
    status: 'unavailable',
    pending: 0,
    deadLetter: 0,
    note: 'The direct Odoo adapter is not implemented in this release.',
  },
  {
    destination: 'n8n reverse commands',
    status: 'unavailable',
    pending: 0,
    deadLetter: 0,
    note: 'The durable inbound command path is not available in this release.',
  },
];

export function createDemoSnapshot() {
  return {
    jobs: structuredClone(demoJobs),
    results: structuredClone(demoResults),
    stats: structuredClone(demoStats),
    capabilities: structuredClone(demoCapabilities),
    reviews: structuredClone(demoReviews),
    deliveries: structuredClone(demoDeliveries),
  };
}
