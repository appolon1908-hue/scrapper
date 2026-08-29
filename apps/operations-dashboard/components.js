import {
  escapeHtml,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  getJobTitle,
  progressPercent,
  shortId,
  statusMeta,
  summarizeJobs,
} from './state.js';

const iconPaths = Object.freeze({
  overview: '<path d="M4 4h6v6H4zM14 4h6v10h-6zM4 14h6v6H4zM14 18h6v2h-6z"/>',
  jobs: '<path d="M4 5h16M4 12h16M4 19h16M7 3v4M12 10v4M17 17v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  results: '<path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14M8 8h8M8 12h8M8 16h5"/>',
  review:
    '<path d="m9 11 2 2 4-5M5 21h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z"/>',
  delivery:
    '<path d="M3 7h11v10H3zM14 10h4l3 3v4h-7zM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>',
  plug: '<path d="m8 12 4 4 8-8M4 20l5-5M14 3l7 7M6 11l7 7"/>',
  audit: '<path d="M9 3h6l1 2h3v16H5V5h3zM9 10h6M9 14h6M9 18h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  refresh: '<path d="M20 7h-5V2M4 17h5v5M19 11a7 7 0 0 0-12-5L4 9M5 13a7 7 0 0 0 12 5l3-3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.1A1.7 1.7 0 0 0 4.65 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.65a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.37.3.59.7.6 1.1v.3h.1v4h-.1c-.4.01-.8.23-1.1.6Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  shield: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6zM9 12l2 2 4-4"/>',
  warning: '<path d="M12 4 2.8 20h18.4L12 4ZM12 9v5M12 17.5v.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  database:
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  bolt: '<path d="m13 2-8 12h7l-1 8 8-12h-7z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
});

export function icon(name, size = 20) {
  const path = iconPaths[name] || iconPaths.overview;
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

export const navigation = Object.freeze([
  { route: 'overview', label: 'Overview', icon: 'overview' },
  { route: 'jobs', label: 'Jobs', icon: 'jobs' },
  { route: 'new-crawl', label: 'New crawl', icon: 'plus' },
  { route: 'results', label: 'Results', icon: 'results' },
  { route: 'reviews', label: 'Reviews', icon: 'review', preview: true },
  { route: 'deliveries', label: 'Deliveries', icon: 'delivery' },
  { route: 'integrations', label: 'Integrations', icon: 'plug' },
  { route: 'audit', label: 'Session audit', icon: 'audit' },
]);

export function renderNavigation(activeRoute) {
  return navigation
    .map(
      (item) => `
        <a class="nav-link${activeRoute === item.route ? ' is-active' : ''}" href="#/${item.route}" data-route="${item.route}">
          <span class="nav-icon">${icon(item.icon, 19)}</span>
          <span>${escapeHtml(item.label)}</span>
          ${item.preview ? '<span class="nav-preview">Preview</span>' : ''}
        </a>
      `,
    )
    .join('');
}

function badge(label, tone = 'muted') {
  return `<span class="badge badge--${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function statusBadge(status) {
  const meta = statusMeta(status);
  return badge(meta.label, meta.tone);
}

function metricCard({ label, value, hint, iconName, tone = 'gold', trend }) {
  return `
    <article class="metric-card metric-card--${tone}">
      <div class="metric-card__top">
        <span class="metric-card__icon">${icon(iconName, 20)}</span>
        ${trend ? `<span class="metric-card__trend">${escapeHtml(trend)}</span>` : ''}
      </div>
      <p class="metric-card__label">${escapeHtml(label)}</p>
      <strong class="metric-card__value">${escapeHtml(value)}</strong>
      <p class="metric-card__hint">${escapeHtml(hint)}</p>
    </article>
  `;
}

function sparkline(values) {
  const width = 260;
  const height = 84;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * (height - 12) - 6;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Throughput trend">
      <defs>
        <linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.28"></stop>
          <stop offset="100%" stop-color="currentColor" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <polyline class="sparkline__area" points="0,${height} ${points} ${width},${height}"></polyline>
      <polyline class="sparkline__line" points="${points}"></polyline>
    </svg>
  `;
}

function pipelineBars(summary) {
  const total = Math.max(summary.total, 1);
  const segments = [
    ['Running', summary.running, 'info'],
    ['Queued', summary.queued, 'neutral'],
    ['Completed', summary.completed, 'success'],
    ['Failed', summary.failed, 'danger'],
    ['Cancelled', summary.cancelled, 'muted'],
  ];

  return `
    <div class="pipeline-bar" role="img" aria-label="Job status distribution">
      ${segments
        .map(
          ([label, value, tone]) => `
            <span class="pipeline-bar__segment pipeline-bar__segment--${tone}" style="--segment:${Math.max(
              (value / total) * 100,
              value > 0 ? 3 : 0,
            )}%" title="${escapeHtml(label)}: ${escapeHtml(value)}"></span>
          `,
        )
        .join('')}
    </div>
    <div class="pipeline-legend">
      ${segments
        .map(
          ([label, value, tone]) => `
            <span><i class="legend-dot legend-dot--${tone}"></i>${escapeHtml(label)} <strong>${escapeHtml(
              value,
            )}</strong></span>
          `,
        )
        .join('')}
    </div>
  `;
}

function healthCard({ label, state, detail, iconName }) {
  const healthy = state === 'healthy' || state === 'ready' || state === 'available';
  const tone = healthy ? 'success' : state === 'unknown' ? 'muted' : 'warning';
  return `
    <div class="health-card">
      <span class="health-card__icon health-card__icon--${tone}">${icon(iconName, 19)}</span>
      <div>
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
      <i class="health-dot health-dot--${tone}" title="${escapeHtml(state)}"></i>
    </div>
  `;
}

function recentJobsTable(jobs, limit = 6) {
  return `
    <div class="table-shell">
      <table class="data-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Companies</th>
            <th>Updated</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${jobs
            .slice(0, limit)
            .map((job) => {
              const percent = progressPercent(job);
              const companies =
                job.progress?.companiesResolved ?? job.progress?.companies_resolved ?? 0;
              return `
                <tr data-job-row="${escapeHtml(job.id)}">
                  <td>
                    <button class="job-link" type="button" data-open-job="${escapeHtml(job.id)}">
                      <span class="job-link__title">${escapeHtml(getJobTitle(job))}</span>
                      <span class="job-link__id">${escapeHtml(shortId(job.id))}</span>
                    </button>
                  </td>
                  <td>${statusBadge(job.status)}</td>
                  <td>
                    <div class="progress-cell">
                      <div class="progress-track"><span style="--progress:${percent}%"></span></div>
                      <small>${percent}%</small>
                    </div>
                  </td>
                  <td>${escapeHtml(formatNumber(companies))}</td>
                  <td><time datetime="${escapeHtml(job.updated_at)}">${escapeHtml(
                    formatRelativeTime(job.updated_at),
                  )}</time></td>
                  <td>
                    <button class="icon-button icon-button--quiet" type="button" data-open-job="${escapeHtml(
                      job.id,
                    )}" aria-label="Open ${escapeHtml(getJobTitle(job))}">
                      ${icon('chevron', 18)}
                    </button>
                  </td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function capabilityRows(capabilities = {}) {
  const rows = [
    ['Crawl job API', capabilities.crawl_job_api, 'Core job commands and status'],
    ['HTTP crawler', capabilities.http_crawler, 'Fast public-page extraction'],
    ['Browser crawler', capabilities.playwright_crawler, 'JavaScript fallback'],
    [
      'External middleware delivery',
      capabilities.outbound_middleware_delivery,
      'Signed outbox delivery',
    ],
    ['Registry enrichment', capabilities.registry_enrichment, 'Provider-backed verification'],
    ['n8n reverse commands', capabilities.n8n_reverse_command_inbox, 'Durable inbound inbox'],
    ['Odoo CRM projection', capabilities.odoo_crm_projection, 'CRM write projection'],
  ];

  return rows
    .map(([label, value, detail]) => {
      const available = value === true;
      return `
        <div class="capability-row">
          <span class="capability-row__status capability-row__status--${available ? 'on' : 'off'}">
            ${available ? icon('check', 14) : icon('close', 14)}
          </span>
          <div>
            <strong>${escapeHtml(label)}</strong>
            <span>${escapeHtml(detail)}</span>
          </div>
          ${badge(available ? 'Available' : 'Disabled', available ? 'success' : 'muted')}
        </div>
      `;
    })
    .join('');
}

export function renderOverview(state) {
  const summary = summarizeJobs(state.jobs);
  const stats = state.stats || {};
  const throughput = state.demoMode
    ? [24, 31, 28, 42, 48, 51, 47, 63, 59, 74, 81, 77]
    : state.throughput || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  return `
    <section class="view-stack" aria-labelledby="overview-heading">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Operations overview</p>
          <h1 id="overview-heading">Crawler control center</h1>
          <p>Monitor bounded crawl workloads, review results, and keep every outbound capability explicit.</p>
        </div>
        <div class="page-heading__actions">
          <button class="button button--secondary" type="button" data-refresh>
            ${icon('refresh', 17)} Refresh
          </button>
          <a class="button button--primary" href="#/new-crawl">
            ${icon('plus', 17)} New crawl
          </a>
        </div>
      </div>

      <div class="safety-banner" role="status">
        <span class="safety-banner__icon">${icon('shield', 21)}</span>
        <div>
          <strong>${state.demoMode ? 'Design preview — no live data' : 'Controlled operations mode'}</strong>
          <span>External delivery and registry enrichment are not assumed active. Write controls are ${
            state.writeControlsEnabled ? 'enabled by deployment configuration' : 'locked off'
          }.</span>
        </div>
        ${badge(state.writeControlsEnabled ? 'Writes enabled' : 'Write-safe', state.writeControlsEnabled ? 'warning' : 'success')}
      </div>

      <div class="metric-grid">
        ${metricCard({
          label: 'Active jobs',
          value: formatNumber(stats.jobs_active ?? summary.active),
          hint: `${summary.running} running · ${summary.queued} queued`,
          iconName: 'bolt',
          tone: 'gold',
          trend: 'Live queue',
        })}
        ${metricCard({
          label: 'Completed today',
          value: formatNumber(stats.jobs_completed_today ?? summary.completed),
          hint: `${summary.successRate}% terminal success rate`,
          iconName: 'check',
          tone: 'green',
          trend: state.demoMode ? '+12%' : 'Today',
        })}
        ${metricCard({
          label: 'Companies resolved',
          value: formatNumber(stats.businesses_resolved_today ?? stats.businesses_total ?? 0),
          hint: `${formatNumber(stats.pages_processed_today ?? 0)} pages processed`,
          iconName: 'globe',
          tone: 'blue',
          trend: 'Today',
        })}
        ${metricCard({
          label: 'Delivery backlog',
          value: formatNumber(stats.outbox_pending ?? 0),
          hint: `${formatNumber(stats.outbox_dead_letter ?? 0)} dead-letter events`,
          iconName: 'delivery',
          tone: 'violet',
          trend: state.capabilities?.outbound_middleware_delivery ? 'Enabled' : 'Disabled',
        })}
      </div>

      <div class="dashboard-grid dashboard-grid--analytics">
        <article class="panel panel--large">
          <div class="panel__header">
            <div>
              <p class="eyebrow">Throughput</p>
              <h2>Resolved companies</h2>
            </div>
            <div class="segmented-control" aria-label="Throughput range">
              <button class="is-active" type="button">12h</button>
              <button type="button">24h</button>
              <button type="button">7d</button>
            </div>
          </div>
          <div class="chart-summary">
            <strong>${formatNumber(stats.businesses_resolved_today ?? 0)}</strong>
            <span>resolved in the selected window</span>
          </div>
          ${sparkline(throughput)}
          <div class="chart-axis"><span>12 hours ago</span><span>Now</span></div>
        </article>

        <article class="panel">
          <div class="panel__header">
            <div>
              <p class="eyebrow">Pipeline</p>
              <h2>Job distribution</h2>
            </div>
            ${badge(`${summary.total} visible`, 'neutral')}
          </div>
          ${pipelineBars(summary)}
          <div class="pipeline-stat">
            <strong>${summary.successRate}%</strong>
            <span>Terminal success rate</span>
          </div>
          <a class="text-link" href="#/jobs">View all jobs ${icon('arrow', 15)}</a>
        </article>
      </div>

      <div class="dashboard-grid dashboard-grid--main">
        <article class="panel panel--table">
          <div class="panel__header">
            <div>
              <p class="eyebrow">Workload</p>
              <h2>Recent jobs</h2>
            </div>
            <a class="text-link" href="#/jobs">Open job manager ${icon('arrow', 15)}</a>
          </div>
          ${recentJobsTable(state.jobs)}
        </article>

        <div class="panel-stack">
          <article class="panel">
            <div class="panel__header">
              <div>
                <p class="eyebrow">Runtime</p>
                <h2>System health</h2>
              </div>
              ${badge(state.readiness === 'ready' ? 'Ready' : 'Unverified', state.readiness === 'ready' ? 'success' : 'muted')}
            </div>
            <div class="health-list">
              ${healthCard({
                label: 'API',
                state: state.health === 'healthy' ? 'healthy' : 'unknown',
                detail: state.health === 'healthy' ? 'Responding normally' : 'Not connected',
                iconName: 'bolt',
              })}
              ${healthCard({
                label: 'PostgreSQL',
                state: state.readiness === 'ready' ? 'ready' : 'unknown',
                detail:
                  state.readiness === 'ready' ? 'Readiness confirmed' : 'Runtime not verified',
                iconName: 'database',
              })}
              ${healthCard({
                label: 'Redis queue',
                state: state.readiness === 'ready' ? 'ready' : 'unknown',
                detail:
                  state.readiness === 'ready' ? 'Queue dependency ready' : 'Runtime not verified',
                iconName: 'jobs',
              })}
              ${healthCard({
                label: 'Gateway paths',
                state: state.capabilities?.runtime_paths_verified ? 'ready' : 'unknown',
                detail: state.capabilities?.runtime_paths_verified
                  ? 'Verified runtime contract'
                  : 'Read-only inventory still required',
                iconName: 'shield',
              })}
            </div>
          </article>

          <article class="panel">
            <div class="panel__header">
              <div>
                <p class="eyebrow">Capability truth</p>
                <h2>Available modules</h2>
              </div>
              <a class="text-link" href="#/integrations">Details</a>
            </div>
            <div class="capability-list">${capabilityRows(state.capabilities)}</div>
          </article>
        </div>
      </div>
    </section>
  `;
}

function jobFilterOptions(selected) {
  const options = [
    ['', 'All statuses'],
    ['queued', 'Queued'],
    ['running', 'Running'],
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['cancel_requested', 'Cancelling'],
    ['cancelled', 'Cancelled'],
  ];
  return options
    .map(
      ([value, label]) =>
        `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`,
    )
    .join('');
}

export function renderJobs(state) {
  const search = state.jobFilters.search.toLowerCase().trim();
  const status = state.jobFilters.status;
  const jobs = state.jobs.filter((job) => {
    if (status && job.status !== status) return false;
    if (!search) return true;
    return `${getJobTitle(job)} ${job.id} ${job.status}`.toLowerCase().includes(search);
  });

  return `
    <section class="view-stack" aria-labelledby="jobs-heading">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Workload manager</p>
          <h1 id="jobs-heading">Crawl jobs</h1>
          <p>Track every queued, active, terminal, and recovery state without exposing internal secrets.</p>
        </div>
        <a class="button button--primary" href="#/new-crawl">${icon('plus', 17)} New crawl</a>
      </div>

      <div class="toolbar">
        <label class="search-field">
          <span class="sr-only">Search jobs</span>
          ${icon('search', 17)}
          <input type="search" placeholder="Search domain or job ID" value="${escapeHtml(
            state.jobFilters.search,
          )}" data-job-search />
        </label>
        <label class="select-field">
          <span class="sr-only">Filter by status</span>
          <select data-job-status>${jobFilterOptions(state.jobFilters.status)}</select>
        </label>
        <button class="button button--secondary" type="button" data-refresh>${icon(
          'refresh',
          17,
        )} Refresh</button>
      </div>

      <article class="panel panel--table">
        <div class="panel__header panel__header--compact">
          <div>
            <h2>${jobs.length} jobs</h2>
            <p class="panel__description">Only the current tenant’s jobs are requested from the API.</p>
          </div>
          ${state.nextJobCursor ? '<button class="text-link" type="button" data-load-more>Load more</button>' : ''}
        </div>
        ${
          jobs.length
            ? recentJobsTable(jobs, jobs.length)
            : `<div class="empty-state">${icon('search', 28)}<strong>No matching jobs</strong><span>Adjust the status or search filter.</span></div>`
        }
      </article>
    </section>
  `;
}

export function renderNewCrawl(state) {
  const locked = !state.writeControlsEnabled && !state.demoMode;
  return `
    <section class="view-stack" aria-labelledby="new-crawl-heading">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Bounded command</p>
          <h1 id="new-crawl-heading">Create a crawl job</h1>
          <p>Define explicit limits before the request reaches the worker queue.</p>
        </div>
        ${badge(state.demoMode ? 'Demo simulation' : locked ? 'Writes locked' : 'Writes enabled', state.demoMode ? 'neutral' : locked ? 'muted' : 'warning')}
      </div>

      <div class="form-layout">
        <form class="panel form-panel" data-crawl-form novalidate>
          <div class="form-section">
            <div class="form-section__heading">
              <span>01</span>
              <div><h2>Targets</h2><p>One public HTTPS URL per line. Private-network addresses are rejected by the API.</p></div>
            </div>
            <label class="field field--full">
              <span>Seed URLs</span>
              <textarea name="seedUrls" rows="7" placeholder="https://company-one.example/&#10;https://company-two.example/" required></textarea>
              <small>Up to 500 URLs in this dashboard command. The server remains authoritative.</small>
            </label>
          </div>

          <div class="form-section">
            <div class="form-section__heading">
              <span>02</span>
              <div><h2>Extraction profile</h2><p>Choose the data scope and rendering strategy.</p></div>
            </div>
            <div class="field-grid">
              <label class="field">
                <span>Profile</span>
                <select name="profile">
                  <option value="full">Full business profile</option>
                  <option value="company">Company details</option>
                  <option value="contacts">Contacts only</option>
                  <option value="registry">Registry enrichment</option>
                </select>
              </label>
              <label class="field">
                <span>Browser strategy</span>
                <select name="browser">
                  <option value="auto">Automatic fallback</option>
                  <option value="http">HTTP only</option>
                  <option value="playwright">Browser required</option>
                </select>
              </label>
              <label class="field">
                <span>Country</span>
                <input name="countryCode" value="US" maxlength="2" pattern="[A-Za-z]{2}" />
              </label>
              <label class="field">
                <span>Mode</span>
                <select name="mode">
                  <option value="domain">Domain crawl</option>
                  <option value="single">Single page</option>
                  <option value="list">Explicit list</option>
                  <option value="discovery">Discovery</option>
                </select>
              </label>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section__heading">
              <span>03</span>
              <div><h2>Safety limits</h2><p>Hard bounds keep each workload predictable and reviewable.</p></div>
            </div>
            <div class="field-grid field-grid--three">
              <label class="field">
                <span>Max pages</span>
                <input type="number" name="maxPages" value="250" min="1" max="50000" required />
              </label>
              <label class="field">
                <span>Max companies</span>
                <input type="number" name="maxCompanies" value="500" min="1" max="5000" required />
              </label>
              <label class="field">
                <span>Max depth</span>
                <input type="number" name="maxDepth" value="3" min="0" max="8" required />
              </label>
              <label class="field">
                <span>Requests / second</span>
                <input type="number" name="requestsPerSecond" value="1" min="0.1" max="10" step="0.1" required />
              </label>
              <label class="field field--span-two">
                <span>Callback reference <em>optional</em></span>
                <input name="callbackReference" maxlength="200" placeholder="CRM campaign or case reference" />
              </label>
            </div>
          </div>

          <div class="form-error" data-form-error hidden></div>
          <div class="form-actions">
            <button class="button button--secondary" type="reset">Reset</button>
            <button class="button button--primary" type="submit"${locked ? ' disabled' : ''}>
              ${icon('bolt', 17)} ${state.demoMode ? 'Simulate crawl' : 'Create crawl job'}
            </button>
          </div>
        </form>

        <aside class="panel form-aside">
          <div class="form-aside__icon">${icon('shield', 24)}</div>
          <h2>Command safety</h2>
          <ul class="check-list">
            <li>${icon('check', 15)} Idempotency key generated per submission</li>
            <li>${icon('check', 15)} Correlation ID attached for support</li>
            <li>${icon('check', 15)} Tenant authority comes from authentication</li>
            <li>${icon('check', 15)} Private network and robots rules enforced server-side</li>
            <li>${icon('check', 15)} External delivery remains capability-gated</li>
          </ul>
          <div class="aside-note">
            <strong>Registry profile</strong>
            <span>Unavailable unless the API explicitly reports registry enrichment enabled and the user has the required scope.</span>
          </div>
        </aside>
      </div>
    </section>
  `;
}

function resultRow(item) {
  const record = item.record || {};
  const confidence = Math.round(Number(record.confidence || 0) * 100);
  const categories = record.categories || [];
  const emails = record.emails || [];
  const phones = record.phones || [];
  return `
    <tr>
      <td>
        <div class="entity-cell">
          <span class="entity-mark">${escapeHtml((record.displayName || record.domain || '?').slice(0, 2).toUpperCase())}</span>
          <div><strong>${escapeHtml(record.displayName || 'Unnamed business')}</strong><span>${escapeHtml(record.domain || 'No domain')}</span></div>
        </div>
      </td>
      <td><div class="confidence"><span style="--confidence:${confidence}%"></span><strong>${confidence}%</strong></div></td>
      <td>${categories.length ? categories.map((value) => badge(value, 'neutral')).join(' ') : '<span class="muted">Unclassified</span>'}</td>
      <td><span>${escapeHtml(emails[0] || phones[0] || 'No contact')}</span></td>
      <td><time datetime="${escapeHtml(record.lastSeenAt || '')}">${escapeHtml(formatRelativeTime(record.lastSeenAt))}</time></td>
      <td><button class="icon-button icon-button--quiet" type="button" aria-label="Open result">${icon('chevron', 18)}</button></td>
    </tr>
  `;
}

export function renderResults(state) {
  const selectedJob =
    state.selectedResultJobId || state.jobs.find((job) => job.status === 'completed')?.id;
  const resultJob = state.jobs.find((job) => job.id === selectedJob);
  return `
    <section class="view-stack" aria-labelledby="results-heading">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Resolved entities</p>
          <h1 id="results-heading">Business results</h1>
          <p>Inspect normalized records and evidence confidence without exposing protected identifiers.</p>
        </div>
        <button class="button button--secondary" type="button" data-export-results>
          ${icon('download', 17)} Export view
        </button>
      </div>

      <div class="toolbar">
        <label class="select-field select-field--wide">
          <span class="sr-only">Select completed job</span>
          <select data-result-job>
            ${state.jobs
              .filter((job) => job.status === 'completed' || job.id === selectedJob)
              .map(
                (job) =>
                  `<option value="${escapeHtml(job.id)}"${job.id === selectedJob ? ' selected' : ''}>${escapeHtml(
                    getJobTitle(job),
                  )} · ${escapeHtml(shortId(job.id))}</option>`,
              )
              .join('')}
          </select>
        </label>
        ${resultJob ? statusBadge(resultJob.status) : ''}
        <span class="toolbar__summary">${state.results.length} records in this page</span>
      </div>

      <article class="panel panel--table">
        <div class="panel__header">
          <div><h2>${escapeHtml(resultJob ? getJobTitle(resultJob) : 'Select a job')}</h2><p class="panel__description">Confidence is derived from available evidence, not an authoritative registry claim.</p></div>
          ${badge('PII-minimized view', 'success')}
        </div>
        <div class="table-shell">
          <table class="data-table data-table--results">
            <thead><tr><th>Business</th><th>Confidence</th><th>Categories</th><th>Primary contact</th><th>Last seen</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${state.results.map(resultRow).join('')}</tbody>
          </table>
        </div>
        ${
          state.results.length
            ? ''
            : `<div class="empty-state">${icon('results', 28)}<strong>No records loaded</strong><span>Choose a completed job or refresh the API connection.</span></div>`
        }
      </article>
    </section>
  `;
}

export function renderReviews(state) {
  return `
    <section class="view-stack" aria-labelledby="reviews-heading">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Design preview</p>
          <h1 id="reviews-heading">Human review queue</h1>
          <p>The interaction model is ready, but the stable API contract does not yet expose review commands.</p>
        </div>
        ${badge('API pending', 'warning')}
      </div>
      <div class="preview-banner">
        ${icon('warning', 20)}
        <div><strong>Preview data only</strong><span>Approve, reject, merge, and split actions remain disabled until the durable review API is merged and advertised by capabilities.</span></div>
      </div>
      <div class="review-grid">
        ${state.reviews
          .map(
            (review) => `
              <article class="panel review-card">
                <div class="review-card__top"><span>${escapeHtml(review.id)}</span>${badge(`${Math.round(review.confidence * 100)}% confidence`, 'warning')}</div>
                <h2>${escapeHtml(review.company)}</h2>
                <p>${escapeHtml(review.reason)}</p>
                <div class="review-card__meta"><span>${icon('clock', 15)} ${escapeHtml(review.age)}</span><span>Decision required</span></div>
                <div class="review-card__actions">
                  <button class="button button--secondary" type="button" disabled>Reject</button>
                  <button class="button button--primary" type="button" disabled>Review evidence</button>
                </div>
              </article>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

export function renderDeliveries(state) {
  return `
    <section class="view-stack" aria-labelledby="deliveries-heading">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Outbound operations</p>
          <h1 id="deliveries-heading">Delivery control</h1>
          <p>Backlog visibility never implies that Odoo, n8n, or middleware writes are active.</p>
        </div>
        ${badge(state.capabilities?.outbound_middleware_delivery ? 'Delivery enabled' : 'Delivery disabled', state.capabilities?.outbound_middleware_delivery ? 'warning' : 'success')}
      </div>
      <div class="delivery-grid">
        ${state.deliveries
          .map(
            (delivery) => `
              <article class="panel delivery-card">
                <div class="delivery-card__header">
                  <span class="delivery-card__icon">${icon('delivery', 22)}</span>
                  ${badge(delivery.status, delivery.status === 'enabled' ? 'success' : delivery.status === 'disabled' ? 'warning' : 'muted')}
                </div>
                <h2>${escapeHtml(delivery.destination)}</h2>
                <p>${escapeHtml(delivery.note)}</p>
                <div class="delivery-metrics">
                  <div><strong>${escapeHtml(delivery.pending)}</strong><span>Pending</span></div>
                  <div><strong>${escapeHtml(delivery.deadLetter)}</strong><span>Dead-letter</span></div>
                </div>
                <button class="button button--secondary button--full" type="button" disabled>Replay requires API capability</button>
              </article>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

export function renderIntegrations(state) {
  const capabilities = state.capabilities || {};
  const integrationCards = [
    {
      name: 'Core crawler API',
      available: Boolean(capabilities.crawl_job_api),
      detail: 'Job creation, status, results, cancellation, and retry.',
      iconName: 'bolt',
    },
    {
      name: 'Keycloak human login',
      available: state.connection.authMode === 'same-origin' && !state.demoMode,
      detail: 'Production UI should use a same-origin BFF or PKCE session boundary.',
      iconName: 'shield',
    },
    {
      name: 'n8n command inbox',
      available: Boolean(capabilities.n8n_reverse_command_inbox),
      detail: 'Signed, replay-protected reverse commands.',
      iconName: 'plug',
    },
    {
      name: 'Odoo CRM projection',
      available: Boolean(capabilities.odoo_crm_projection),
      detail: 'Idempotent CRM projection and reconciliation.',
      iconName: 'database',
    },
    {
      name: 'Registry / EIN provider',
      available: Boolean(capabilities.authoritative_ein_provider),
      detail: 'Authoritative provider-backed verification.',
      iconName: 'globe',
    },
    {
      name: 'Verified runtime paths',
      available: Boolean(capabilities.runtime_paths_verified),
      detail: 'Read-only runtime inventory and approved fingerprint.',
      iconName: 'audit',
    },
  ];

  return `
    <section class="view-stack" aria-labelledby="integrations-heading">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Capability truth</p>
          <h1 id="integrations-heading">Integrations and runtime</h1>
          <p>Every card is driven by explicit capability evidence. Unknown never becomes “connected.”</p>
        </div>
        <button class="button button--secondary" type="button" data-open-settings>${icon('settings', 17)} Connection</button>
      </div>
      <div class="integration-grid">
        ${integrationCards
          .map(
            (integration) => `
              <article class="panel integration-card">
                <div class="integration-card__icon integration-card__icon--${integration.available ? 'on' : 'off'}">${icon(integration.iconName, 24)}</div>
                <div class="integration-card__heading"><h2>${escapeHtml(integration.name)}</h2>${badge(integration.available ? 'Available' : 'Not available', integration.available ? 'success' : 'muted')}</div>
                <p>${escapeHtml(integration.detail)}</p>
                <div class="integration-card__footer"><span>${integration.available ? 'Capability reported by current context' : 'No affirmative capability evidence'}</span></div>
              </article>
            `,
          )
          .join('')}
      </div>
      <article class="panel contract-panel">
        <div><p class="eyebrow">Connection contract</p><h2>Current dashboard boundary</h2></div>
        <dl>
          <div><dt>API base</dt><dd>${escapeHtml(state.connection.apiBaseUrl || 'Same origin')}</dd></div>
          <div><dt>Tenant</dt><dd>${escapeHtml(state.connection.tenantId || 'From authenticated session')}</dd></div>
          <div><dt>Authentication</dt><dd>${escapeHtml(state.connection.authMode)}</dd></div>
          <div><dt>Data source</dt><dd>${state.demoMode ? 'Design preview' : 'Configured API'}</dd></div>
          <div><dt>Write controls</dt><dd>${state.writeControlsEnabled ? 'Enabled by immutable config' : 'Disabled'}</dd></div>
        </dl>
      </article>
    </section>
  `;
}

export function renderAudit(state) {
  return `
    <section class="view-stack" aria-labelledby="audit-heading">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Browser session</p>
          <h1 id="audit-heading">Session audit</h1>
          <p>Local interaction history for this dashboard tab. It is not the server’s authoritative audit ledger.</p>
        </div>
        ${badge('Local only', 'neutral')}
      </div>
      <article class="panel timeline-panel">
        <ol class="timeline">
          ${state.auditEvents
            .map(
              (event) => `
                <li>
                  <span class="timeline__dot timeline__dot--${escapeHtml(event.tone || 'neutral')}"></span>
                  <div><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.detail)}</p><time datetime="${escapeHtml(event.at)}">${escapeHtml(formatDateTime(event.at))}</time></div>
                </li>
              `,
            )
            .join('')}
        </ol>
      </article>
    </section>
  `;
}

export function renderJobDrawer(job, state) {
  if (!job) return '';
  const percent = progressPercent(job);
  const meta = statusMeta(job.status);
  const canCancel = ['queued', 'running', 'cancel_requested'].includes(job.status);
  const canRetry = ['failed', 'cancelled'].includes(job.status);
  const actionsLocked = !state.writeControlsEnabled && !state.demoMode;

  return `
    <div class="drawer__header">
      <div><p class="eyebrow">Job ${escapeHtml(shortId(job.id))}</p><h2>${escapeHtml(getJobTitle(job))}</h2></div>
      <button class="icon-button" type="button" data-close-drawer aria-label="Close job details">${icon('close', 20)}</button>
    </div>
    <div class="drawer__body">
      <div class="drawer-status"><div>${statusBadge(job.status)}<span>Version ${escapeHtml(job.version)}</span></div><strong>${percent}%</strong></div>
      <div class="progress-track progress-track--large"><span style="--progress:${percent}%"></span></div>
      <dl class="detail-list">
        <div><dt>Job ID</dt><dd><code>${escapeHtml(job.id)}</code><button class="copy-button" type="button" data-copy="${escapeHtml(job.id)}" aria-label="Copy job ID">${icon('copy', 15)}</button></dd></div>
        <div><dt>Correlation</dt><dd><code>${escapeHtml(job.correlation_id || 'Not provided')}</code></dd></div>
        <div><dt>Created</dt><dd>${escapeHtml(formatDateTime(job.created_at))}</dd></div>
        <div><dt>Started</dt><dd>${escapeHtml(formatDateTime(job.started_at))}</dd></div>
        <div><dt>Completed</dt><dd>${escapeHtml(formatDateTime(job.completed_at))}</dd></div>
        <div><dt>Browser</dt><dd>${escapeHtml(job.payload?.browser || 'auto')}</dd></div>
        <div><dt>Profile</dt><dd>${escapeHtml(job.payload?.profile || 'full')}</dd></div>
        <div><dt>Country</dt><dd>${escapeHtml(job.payload?.countryCode || job.payload?.country_code || 'US')}</dd></div>
      </dl>
      <div class="drawer-section">
        <h3>Progress</h3>
        <div class="drawer-metrics">
          <div><strong>${escapeHtml(job.progress?.pagesProcessed ?? 0)}</strong><span>Pages processed</span></div>
          <div><strong>${escapeHtml(job.progress?.companiesResolved ?? 0)}</strong><span>Companies resolved</span></div>
          <div><strong>${escapeHtml(job.progress?.pagesFailed ?? 0)}</strong><span>Page failures</span></div>
          <div><strong>${escapeHtml(job.progress?.pagesDeniedByRobots ?? 0)}</strong><span>Robots denied</span></div>
        </div>
      </div>
      ${
        job.error
          ? `<div class="error-card"><strong>${escapeHtml(job.error.code || 'Job failed')}</strong><p>${escapeHtml(job.error.message || 'No error detail was returned.')}</p></div>`
          : ''
      }
      <div class="drawer-section"><h3>Seed targets</h3><ul class="seed-list">${(job.payload?.seedUrls || []).map((url) => `<li>${icon('globe', 15)}<span>${escapeHtml(url)}</span></li>`).join('')}</ul></div>
    </div>
    <div class="drawer__footer">
      ${canRetry ? `<button class="button button--secondary" type="button" data-retry-job="${escapeHtml(job.id)}"${actionsLocked ? ' disabled' : ''}>Retry job</button>` : ''}
      ${canCancel ? `<button class="button button--danger" type="button" data-cancel-job="${escapeHtml(job.id)}"${actionsLocked ? ' disabled' : ''}>${meta.label === 'Cancelling' ? 'Cancellation requested' : 'Cancel job'}</button>` : ''}
      ${job.status === 'completed' ? `<a class="button button--primary" href="#/results" data-view-results="${escapeHtml(job.id)}">View results</a>` : ''}
    </div>
  `;
}

export function renderRoute(route, state) {
  const renderers = {
    overview: renderOverview,
    jobs: renderJobs,
    'new-crawl': renderNewCrawl,
    results: renderResults,
    reviews: renderReviews,
    deliveries: renderDeliveries,
    integrations: renderIntegrations,
    audit: renderAudit,
  };
  return (renderers[route] || renderOverview)(state);
}
