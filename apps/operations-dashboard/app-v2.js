import { ApiError, DashboardApiClient, newCommandId } from './api-client.js';
import { navigation, renderDrawer, renderNavigation, renderRoute } from './components-v2.js';
import { createDemoSnapshot } from './mock-data.js';
import { createStore, getJobTitle } from './state.js';
import {
  filterResults,
  mergeById,
  normalizeCapabilities,
  normalizeHealthStatus,
  normalizeStats,
  parseCrawlPayload,
  parseImportText,
  resultsToCsv,
  safeFilePart,
} from './dashboard-utils.js';

const config = Object.freeze({
  productName: 'Crawler Control',
  environmentLabel: 'Review preview',
  apiBaseUrl: '',
  tenantId: '',
  demoMode: true,
  authMode: 'same-origin',
  allowDevelopmentToken: false,
  writeControlsEnabled: false,
  refreshSeconds: 20,
  requestTimeoutMs: 15_000,
  ...(globalThis.CODESTRA_DASHBOARD_CONFIG || {}),
});

const SESSION_CONNECTION_KEY = 'codestra.dashboard.connection.v2';
const SESSION_TOKEN_KEY = 'codestra.dashboard.development-token.v1';
const MAX_AUDIT_EVENTS = 100;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const routeLabels = new Map(navigation.map((item) => [item.route, item.label]));

const elements = {
  shell: document.querySelector('#dashboard-shell'),
  sidebar: document.querySelector('#sidebar'),
  sidebarBackdrop: document.querySelector('#sidebar-backdrop'),
  mobileMenu: document.querySelector('#mobile-menu'),
  navigation: document.querySelector('#navigation'),
  view: document.querySelector('#view'),
  drawer: document.querySelector('#job-drawer'),
  drawerOverlay: document.querySelector('#drawer-overlay'),
  settingsDialog: document.querySelector('#settings-dialog'),
  settingsForm: document.querySelector('#settings-form'),
  tokenField: document.querySelector('#development-token-field'),
  settingsWriteState: document.querySelector('#settings-write-state'),
  environmentLabel: document.querySelector('#environment-label'),
  environmentDetail: document.querySelector('#environment-detail'),
  connectionPill: document.querySelector('#connection-pill'),
  connectionCopy: document.querySelector('#connection-copy'),
  topbarContext: document.querySelector('#topbar-context'),
  topbarTitle: document.querySelector('#topbar-title'),
  loadingOverlay: document.querySelector('#loading-overlay'),
  toastRegion: document.querySelector('#toast-region'),
};

for (const [name, element] of Object.entries(elements)) {
  if (!element) throw new Error(`dashboard_element_missing:${name}`);
}

const sessionConnection = readSessionConnection();
const demoSnapshot = createDemoSnapshot();
const initialRoute = routeFromHash();
const initialDemoMode = sessionConnection.demoMode ?? Boolean(config.demoMode);
const initialState = {
  route: initialRoute,
  ...demoSnapshot,
  stats: normalizeStats(demoSnapshot.stats, demoSnapshot.jobs),
  capabilities: normalizeCapabilities(demoSnapshot.capabilities),
  demoMode: initialDemoMode,
  writeControlsEnabled: Boolean(config.writeControlsEnabled),
  connection: {
    apiBaseUrl: sessionConnection.apiBaseUrl ?? String(config.apiBaseUrl || ''),
    tenantId: sessionConnection.tenantId ?? String(config.tenantId || ''),
    authMode: String(config.authMode || 'same-origin'),
  },
  serviceInfo: null,
  health: initialDemoMode ? 'healthy' : 'unknown',
  readiness: initialDemoMode ? 'ready' : 'unknown',
  loading: false,
  dataStates: {
    dashboard: initialDemoMode ? 'ready' : 'idle',
    jobs: initialDemoMode ? 'ready' : 'idle',
    results: initialDemoMode ? 'ready' : 'idle',
    diagnostics: 'idle',
    drawer: 'idle',
    command: 'idle',
    import: 'idle',
  },
  errors: {
    dashboard: null,
    jobs: null,
    results: null,
    diagnostics: null,
    drawer: null,
    command: null,
    import: null,
  },
  lastUpdated: null,
  drawer: null,
  selectedResultJobId: demoSnapshot.jobs.find((job) => job.status === 'completed')?.id || null,
  nextJobCursor: null,
  nextResultCursor: null,
  throughputRange: '12h',
  throughput: [24, 31, 28, 42, 48, 51, 47, 63, 59, 74, 81, 77],
  jobFilters: { search: '', status: '', sort: 'updated-desc' },
  resultFilters: { search: '', minConfidence: 0, contact: 'any' },
  importPreview: null,
  draftSeedUrls: '',
  diagnostics: [],
  pendingActions: {},
  auditEvents: [
    auditEvent(
      'Dashboard initialized',
      initialDemoMode ? 'Safe design preview loaded.' : 'Configured API connection loaded.',
      'success',
    ),
  ],
};

const store = createStore(initialState);
let api = createApiClient(initialState.connection);
let autoRefreshTimer = null;
let autoRefreshSignature = '';
let previousFocus = null;
let refreshInFlight = false;

function readSessionConnection() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_CONNECTION_KEY) || '{}');
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function saveSessionConnection(connection) {
  sessionStorage.setItem(SESSION_CONNECTION_KEY, JSON.stringify(connection));
}

function developmentToken() {
  return config.allowDevelopmentToken ? sessionStorage.getItem(SESSION_TOKEN_KEY) : null;
}

function createApiClient(connection) {
  return new DashboardApiClient({
    baseUrl: connection.apiBaseUrl,
    tenantId: connection.tenantId,
    getAccessToken: async () => developmentToken(),
    credentials: 'same-origin',
    timeoutMs: Number(config.requestTimeoutMs || 15_000),
  });
}

function auditEvent(title, detail, tone = 'neutral') {
  return {
    id: globalThis.crypto?.randomUUID?.() || newCommandId(),
    title,
    detail,
    tone,
    at: new Date().toISOString(),
  };
}

function appendAudit(title, detail, tone = 'neutral') {
  store.setState((state) => ({
    ...state,
    auditEvents: [auditEvent(title, detail, tone), ...state.auditEvents].slice(0, MAX_AUDIT_EVENTS),
  }));
}

function routeFromHash() {
  const value = location.hash.replace(/^#\/?/, '').split(/[?&]/)[0];
  return routeLabels.has(value) ? value : 'overview';
}

function setRoute(route, options = {}) {
  const safeRoute = routeLabels.has(route) ? route : 'overview';
  if (location.hash !== `#/${safeRoute}`) {
    location.hash = `#/${safeRoute}`;
    return;
  }
  store.setState((state) => ({ ...state, route: safeRoute }));
  if (options.focus !== false) requestAnimationFrame(() => elements.view.focus());
}

function setBlocking(loading) {
  store.setState((state) => ({ ...state, loading }));
}

function setDataState(key, status, error = null) {
  store.setState((state) => ({
    ...state,
    dataStates: { ...state.dataStates, [key]: status },
    errors: { ...state.errors, [key]: error },
  }));
}

function toast(message, tone = 'neutral', timeout = 4_200) {
  const item = document.createElement('div');
  item.className = `toast toast--${tone}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  requestAnimationFrame(() => item.classList.add('is-visible'));
  setTimeout(() => {
    item.classList.remove('is-visible');
    setTimeout(() => item.remove(), 220);
  }, timeout);
}

function errorMessage(error) {
  if (error instanceof ApiError) {
    const suffix = error.requestId ? ` · request ${error.requestId}` : '';
    return `${error.code || error.message}${suffix}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function render(state) {
  elements.navigation.innerHTML = renderNavigation(state.route);
  elements.view.innerHTML = renderRoute(state.route, state);
  elements.drawer.innerHTML = renderDrawer(state);

  const drawerOpen = Boolean(state.drawer);
  elements.drawer.setAttribute('aria-hidden', String(!drawerOpen));
  elements.drawerOverlay.setAttribute('aria-hidden', String(!drawerOpen));
  document.body.classList.toggle('drawer-open', drawerOpen);
  elements.loadingOverlay.setAttribute('aria-hidden', String(!state.loading));
  elements.view.setAttribute('aria-busy', String(state.loading));
  document.body.classList.toggle('is-loading', state.loading);

  const title = routeLabels.get(state.route) || 'Overview';
  elements.topbarTitle.textContent = title;
  elements.topbarContext.textContent = state.demoMode ? 'Design preview' : 'Operations';
  document.title = `${title} · Codestra Crawler Control`;

  elements.environmentLabel.textContent = config.environmentLabel;
  elements.environmentDetail.textContent = state.demoMode
    ? 'No live runtime assumed'
    : state.readiness === 'ready'
      ? 'API dependencies report ready'
      : 'Connection not yet verified';
  const online = !state.demoMode && state.readiness === 'ready';
  elements.connectionPill.classList.toggle('connection-pill--online', online);
  elements.connectionCopy.textContent = state.demoMode
    ? 'Design preview'
    : online
      ? 'API ready'
      : 'API unverified';

  scheduleAutoRefresh(state);
}

function scheduleAutoRefresh(state) {
  const seconds = Number(config.refreshSeconds || 0);
  const signature = `${state.demoMode}:${seconds}`;
  if (signature === autoRefreshSignature) return;
  autoRefreshSignature = signature;
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  if (state.demoMode || seconds < 5) return;
  autoRefreshTimer = setInterval(() => void refreshDashboard({ quiet: true }), seconds * 1_000);
}

function demoThroughput(range) {
  if (range === '24h')
    return [
      18, 21, 24, 31, 28, 42, 48, 51, 47, 63, 59, 74, 81, 77, 84, 80, 92, 88, 103, 99, 112, 118,
      121, 126,
    ];
  if (range === '7d') return [402, 438, 511, 489, 573, 621, 684];
  return [24, 31, 28, 42, 48, 51, 47, 63, 59, 74, 81, 77];
}

function refreshDemo() {
  store.setState((state) => {
    const jobs = state.jobs.map((job) => {
      if (job.status !== 'running') return job;
      const progress = { ...(job.progress || {}) };
      const maxPages = Number(job.payload?.maxPages || 250);
      progress.pagesProcessed = Math.min(maxPages, Number(progress.pagesProcessed || 0) + 4);
      progress.companiesResolved = Number(progress.companiesResolved || 0) + 1;
      return { ...job, progress, updated_at: new Date().toISOString() };
    });
    return {
      ...state,
      jobs,
      stats: normalizeStats(state.stats, jobs),
      health: 'healthy',
      readiness: 'ready',
      throughput: demoThroughput(state.throughputRange),
      lastUpdated: new Date().toISOString(),
      dataStates: { ...state.dataStates, dashboard: 'ready', jobs: 'ready' },
      errors: { ...state.errors, dashboard: null, jobs: null },
    };
  });
}

function settledError(result) {
  return result.status === 'rejected' ? errorMessage(result.reason) : null;
}

async function refreshDashboard({ quiet = false } = {}) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const state = store.getState();
  if (!quiet) setBlocking(true);
  setDataState('dashboard', 'loading');
  setDataState('jobs', 'loading');

  if (state.demoMode) {
    refreshDemo();
    if (!quiet) toast('Design preview refreshed', 'success');
    setBlocking(false);
    refreshInFlight = false;
    return;
  }

  try {
    const [serviceInfo, health, readiness, capabilities, stats, jobs] = await Promise.allSettled([
      api.serviceInfo(),
      api.health(),
      api.readiness(),
      api.capabilities(),
      api.stats(),
      api.listJobs({ limit: 100 }),
    ]);
    const current = store.getState();
    const nextJobs = jobs.status === 'fulfilled' ? jobs.value.items || [] : current.jobs;
    const nextCapabilities =
      capabilities.status === 'fulfilled'
        ? normalizeCapabilities(capabilities.value)
        : current.capabilities;
    const dashboardErrors = [serviceInfo, health, readiness, capabilities, stats]
      .map(settledError)
      .filter(Boolean);
    const jobsError = settledError(jobs);
    const drawerStillExists =
      !current.drawer ||
      current.drawer.type !== 'job' ||
      nextJobs.some((job) => job.id === current.drawer.id);

    store.setState((previous) => ({
      ...previous,
      serviceInfo: serviceInfo.status === 'fulfilled' ? serviceInfo.value : previous.serviceInfo,
      health:
        health.status === 'fulfilled' ? normalizeHealthStatus(health.value, 'health') : 'unknown',
      readiness:
        readiness.status === 'fulfilled'
          ? normalizeHealthStatus(readiness.value, 'readiness')
          : 'unknown',
      capabilities: nextCapabilities,
      stats:
        stats.status === 'fulfilled'
          ? normalizeStats(stats.value, nextJobs)
          : normalizeStats(previous.stats, nextJobs),
      jobs: nextJobs,
      nextJobCursor:
        jobs.status === 'fulfilled' ? jobs.value.next_cursor || null : previous.nextJobCursor,
      drawer: drawerStillExists ? previous.drawer : null,
      lastUpdated: new Date().toISOString(),
      dataStates: {
        ...previous.dataStates,
        dashboard: dashboardErrors.length ? 'error' : 'ready',
        jobs: jobsError ? 'error' : 'ready',
      },
      errors: {
        ...previous.errors,
        dashboard: dashboardErrors[0] || null,
        jobs: jobsError,
      },
    }));

    if (store.getState().route === 'results' && store.getState().selectedResultJobId) {
      await loadResults(store.getState().selectedResultJobId, { quiet: true });
    }
    const failureCount = dashboardErrors.length + (jobsError ? 1 : 0);
    if (failureCount) {
      toast(`Dashboard refreshed with ${failureCount} unavailable source(s)`, 'warning');
      appendAudit('Partial refresh', `${failureCount} API source(s) were unavailable.`, 'warning');
    } else if (!quiet) {
      toast('Dashboard refreshed from the API', 'success');
    }
  } catch (error) {
    const message = errorMessage(error);
    setDataState('dashboard', 'error', message);
    setDataState('jobs', 'error', message);
    toast(`Refresh failed: ${message}`, 'danger', 6_500);
    appendAudit('Refresh failed', message, 'danger');
  } finally {
    if (!quiet) setBlocking(false);
    refreshInFlight = false;
  }
}

async function loadMoreJobs() {
  const state = store.getState();
  if (state.demoMode || !state.nextJobCursor || state.dataStates.jobs === 'loading') return;
  setDataState('jobs', 'loading');
  try {
    const page = await api.listJobs({
      limit: 100,
      cursor: state.nextJobCursor,
      status: state.jobFilters.status || undefined,
    });
    store.setState((previous) => ({
      ...previous,
      jobs: mergeById(previous.jobs, page.items || []),
      nextJobCursor: page.next_cursor || null,
      dataStates: { ...previous.dataStates, jobs: 'ready' },
      errors: { ...previous.errors, jobs: null },
    }));
    toast('Additional jobs loaded', 'success');
  } catch (error) {
    const message = errorMessage(error);
    setDataState('jobs', 'error', message);
    toast(`Could not load more jobs: ${message}`, 'danger');
  }
}

async function loadResults(jobId, { append = false, quiet = false } = {}) {
  if (!jobId) return;
  const state = store.getState();
  if (!quiet) setBlocking(true);
  setDataState('results', 'loading');
  if (!append) {
    store.setState((previous) => ({
      ...previous,
      selectedResultJobId: jobId,
      results: previous.demoMode ? previous.results : [],
      nextResultCursor: null,
    }));
  }
  if (state.demoMode) {
    setDataState('results', 'ready');
    if (!quiet) setBlocking(false);
    return;
  }

  try {
    const current = store.getState();
    const page = await api.listResults(jobId, {
      limit: 250,
      minConfidence: 0,
      cursor: append ? current.nextResultCursor : undefined,
    });
    store.setState((previous) => ({
      ...previous,
      selectedResultJobId: jobId,
      results: append ? mergeById(previous.results, page.items || []) : page.items || [],
      nextResultCursor: page.next_cursor || null,
      dataStates: { ...previous.dataStates, results: 'ready' },
      errors: { ...previous.errors, results: null },
    }));
  } catch (error) {
    const message = errorMessage(error);
    setDataState('results', 'error', message);
    toast(`Could not load job results: ${message}`, 'danger');
  } finally {
    if (!quiet) setBlocking(false);
  }
}

function openJob(jobId) {
  const state = store.getState();
  if (!state.jobs.some((job) => job.id === jobId)) return;
  previousFocus = document.activeElement;
  store.setState((previous) => ({ ...previous, drawer: { type: 'job', id: jobId } }));
  requestAnimationFrame(() => elements.drawer.querySelector('[data-close-drawer]')?.focus());
  if (!state.demoMode) void refreshJobDetail(jobId);
}

async function refreshJobDetail(jobId) {
  setDataState('drawer', 'loading');
  try {
    const job = await api.getJob(jobId);
    store.setState((state) => ({
      ...state,
      jobs: mergeById(state.jobs, [job]),
      dataStates: { ...state.dataStates, drawer: 'ready' },
      errors: { ...state.errors, drawer: null },
    }));
  } catch (error) {
    setDataState('drawer', 'error', errorMessage(error));
  }
}

function openResult(resultId) {
  if (!store.getState().results.some((item) => item.id === resultId)) return;
  previousFocus = document.activeElement;
  store.setState((state) => ({ ...state, drawer: { type: 'result', id: resultId } }));
  requestAnimationFrame(() => elements.drawer.querySelector('[data-close-drawer]')?.focus());
}

function closeDrawer() {
  if (!store.getState().drawer) return;
  store.setState((state) => ({
    ...state,
    drawer: null,
    dataStates: { ...state.dataStates, drawer: 'idle' },
    errors: { ...state.errors, drawer: null },
  }));
  requestAnimationFrame(() => previousFocus?.focus?.());
}

function showFormError(message) {
  const target = elements.view.querySelector('[data-form-error]');
  if (!target) {
    toast(message, 'danger');
    return;
  }
  target.textContent = message;
  target.hidden = false;
  target.focus();
}

function demoJob(payload, command) {
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() || newCommandId(),
    tenant_id: store.getState().connection.tenantId || 'tenant-design-preview',
    correlation_id: command.correlationId,
    status: 'queued',
    payload,
    progress: {
      pagesProcessed: 0,
      pagesFailed: 0,
      pagesDeniedByRobots: 0,
      browserFallbacks: 0,
      companiesResolved: 0,
    },
    error: null,
    version: 1,
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
    duplicate: false,
  };
}

async function submitCrawl(form) {
  const state = store.getState();
  let payload;
  try {
    payload = parseCrawlPayload(new FormData(form), {
      capabilities: state.capabilities,
      importUrls: state.importPreview?.urls || [],
    });
  } catch (error) {
    showFormError(errorMessage(error));
    return;
  }
  if (!state.demoMode && !state.writeControlsEnabled) {
    showFormError('Write controls are locked by deployment configuration.');
    return;
  }

  const command = { correlationId: newCommandId(), idempotencyKey: newCommandId() };
  setBlocking(true);
  setDataState('command', 'loading');
  try {
    const response = state.demoMode
      ? demoJob(payload, command)
      : await api.createJob(payload, command);
    const created = {
      ...response,
      payload: response.payload || payload,
      correlation_id: response.correlation_id || command.correlationId,
    };
    store.setState((previous) => ({
      ...previous,
      jobs: [created, ...previous.jobs.filter((job) => job.id !== created.id)],
      drawer: { type: 'job', id: created.id },
      route: 'jobs',
      importPreview: null,
      draftSeedUrls: '',
      dataStates: { ...previous.dataStates, command: 'ready', jobs: 'ready' },
      errors: { ...previous.errors, command: null },
    }));
    appendAudit(
      state.demoMode ? 'Crawl simulation created' : 'Crawl command accepted',
      `${getJobTitle(created)} · ${created.id}`,
      'success',
    );
    location.hash = '#/jobs';
    toast(state.demoMode ? 'Safe crawl simulation created' : 'Crawl job accepted', 'success');
  } catch (error) {
    const message = errorMessage(error);
    setDataState('command', 'error', message);
    showFormError(message);
    appendAudit('Crawl command failed', message, 'danger');
  } finally {
    setBlocking(false);
  }
}

function setPending(jobId, value) {
  store.setState((state) => ({
    ...state,
    pendingActions: { ...state.pendingActions, [jobId]: value },
  }));
}

function replaceJob(updated, prior) {
  const normalized = { ...prior, ...updated, payload: updated.payload || prior?.payload };
  store.setState((state) => ({
    ...state,
    jobs: mergeById(state.jobs, [normalized]),
  }));
  return normalized;
}

async function cancelJob(jobId) {
  const state = store.getState();
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job || !['queued', 'running'].includes(job.status)) return;
  if (!state.demoMode && !state.writeControlsEnabled) {
    toast('Write controls are locked by deployment configuration', 'warning');
    return;
  }
  if (!globalThis.confirm(`Request cancellation for ${getJobTitle(job)}?`)) return;
  setPending(jobId, 'cancel');
  try {
    const updated = state.demoMode
      ? {
          ...job,
          status: job.status === 'queued' ? 'cancelled' : 'cancel_requested',
          updated_at: new Date().toISOString(),
          version: Number(job.version || 0) + 1,
        }
      : await api.cancelJob(jobId, { correlationId: newCommandId() });
    const result = replaceJob(updated, job);
    appendAudit('Cancellation requested', `${getJobTitle(result)} · ${result.id}`, 'warning');
    toast('Cancellation request recorded', 'success');
  } catch (error) {
    const message = errorMessage(error);
    toast(`Cancellation failed: ${message}`, 'danger');
    appendAudit('Cancellation failed', `${jobId} · ${message}`, 'danger');
  } finally {
    setPending(jobId, null);
  }
}

async function retryJob(jobId) {
  const state = store.getState();
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job || !['failed', 'cancelled'].includes(job.status)) return;
  if (!state.demoMode && !state.writeControlsEnabled) {
    toast('Write controls are locked by deployment configuration', 'warning');
    return;
  }
  if (!globalThis.confirm(`Queue a retry for ${getJobTitle(job)}?`)) return;
  setPending(jobId, 'retry');
  try {
    const updated = state.demoMode
      ? {
          ...job,
          status: 'queued',
          error: null,
          progress: {},
          updated_at: new Date().toISOString(),
          started_at: null,
          completed_at: null,
          version: Number(job.version || 0) + 1,
        }
      : await api.retryJob(jobId, { correlationId: newCommandId() });
    const result = replaceJob(updated, job);
    appendAudit('Retry requested', `${getJobTitle(result)} · ${result.id}`, 'success');
    toast('Retry accepted', 'success');
  } catch (error) {
    const message = errorMessage(error);
    toast(`Retry failed: ${message}`, 'danger');
    appendAudit('Retry failed', `${jobId} · ${message}`, 'danger');
  } finally {
    setPending(jobId, null);
  }
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportResults(format) {
  const state = store.getState();
  const visible = filterResults(state.results, state.resultFilters);
  if (!visible.length) {
    toast('There are no visible results to export', 'warning');
    return;
  }
  const filePart = safeFilePart(state.selectedResultJobId || 'view');
  if (format === 'csv') {
    downloadBlob(
      resultsToCsv(visible),
      'text/csv;charset=utf-8',
      `codestra-results-${filePart}.csv`,
    );
  } else {
    const payload = {
      exported_at: new Date().toISOString(),
      source: state.demoMode ? 'design-preview' : 'configured-api',
      tenant_id: state.connection.tenantId || null,
      job_id: state.selectedResultJobId,
      record_count: visible.length,
      notice:
        'This browser export may contain business contact information. Apply approved handling policy.',
      records: visible,
    };
    downloadBlob(
      `${JSON.stringify(payload, null, 2)}\n`,
      'application/json',
      `codestra-results-${filePart}.json`,
    );
  }
  appendAudit(
    'Browser export created',
    `${visible.length} visible records · ${format.toUpperCase()}`,
    'warning',
  );
  toast(`${visible.length} visible results exported to ${format.toUpperCase()}`, 'success');
}

async function parseImportFile(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    setDataState('import', 'error', 'Import files must be 5 MB or smaller.');
    return;
  }
  setDataState('import', 'loading');
  try {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const format = extension === 'json' || file.type.includes('json') ? 'json' : 'csv';
    const preview = parseImportText(await file.text(), {
      format,
      maxCompanies: Math.min(
        500,
        Number(store.getState().capabilities.max_companies_per_job || 500),
      ),
    });
    store.setState((state) => ({
      ...state,
      importPreview: { ...preview, fileName: file.name, format, applied: false },
      dataStates: { ...state.dataStates, import: 'ready' },
      errors: { ...state.errors, import: null },
    }));
    appendAudit('Import parsed', `${file.name} · ${preview.urls.length} valid websites`, 'success');
  } catch (error) {
    const message = errorMessage(error);
    setDataState('import', 'error', message);
    toast(`Import failed: ${message}`, 'danger');
  }
}

function applyImport() {
  const preview = store.getState().importPreview;
  if (!preview?.urls?.length) return;
  store.setState((state) => {
    const existing = String(state.draftSeedUrls || '')
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const merged = [...new Set([...existing, ...preview.urls])];
    return {
      ...state,
      draftSeedUrls: merged.join('\n'),
      importPreview: { ...preview, applied: true },
    };
  });
  toast('Imported websites applied to the target list', 'success');
}

function clearImport() {
  store.setState((state) => ({
    ...state,
    importPreview: null,
    dataStates: { ...state.dataStates, import: 'idle' },
    errors: { ...state.errors, import: null },
  }));
}

async function copyText(value) {
  const text = String(value || '');
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'success');
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand?.('copy');
    input.remove();
    toast(
      copied ? 'Copied to clipboard' : 'Clipboard access is unavailable',
      copied ? 'success' : 'warning',
    );
  }
}

function diagnosticResult(label, status, detail, durationMs = null) {
  return { label, status, detail, durationMs };
}

async function runDiagnostic(label, callback, validate = () => true) {
  const started = performance.now();
  try {
    const value = await callback();
    const valid = validate(value);
    return diagnosticResult(
      label,
      valid ? 'pass' : 'fail',
      valid
        ? 'Response matched the documented contract.'
        : 'Response did not match the documented contract.',
      Math.round(performance.now() - started),
    );
  } catch (error) {
    return diagnosticResult(
      label,
      'fail',
      errorMessage(error),
      Math.round(performance.now() - started),
    );
  }
}

async function runDiagnostics() {
  const state = store.getState();
  setDataState('diagnostics', 'loading');
  if (state.demoMode) {
    const labels = [
      'GET /',
      'GET /healthz',
      'GET /readyz',
      'GET /openapi.yaml',
      'GET /api/v2/capabilities',
      'GET /api/v2/stats',
      'GET /api/v2/metrics',
      'GET /api/v2/jobs',
      'GET /api/v2/jobs/{id}',
      'GET /api/v2/jobs/{id}/results',
    ];
    store.setState((previous) => ({
      ...previous,
      diagnostics: labels.map((label) =>
        diagnosticResult(label, 'skipped', 'Design preview does not call a live API.'),
      ),
      dataStates: { ...previous.dataStates, diagnostics: 'ready' },
      errors: { ...previous.errors, diagnostics: null },
    }));
    toast('Read-only checks were simulated in design preview', 'neutral');
    return;
  }

  const selectedJob =
    state.jobs.find((job) => job.id === state.selectedResultJobId) || state.jobs[0] || null;
  const checks = [
    runDiagnostic(
      'GET /',
      () => api.serviceInfo(),
      (value) => Boolean(value?.service && value?.api),
    ),
    runDiagnostic(
      'GET /healthz',
      () => api.health(),
      (value) => normalizeHealthStatus(value) === 'healthy',
    ),
    runDiagnostic(
      'GET /readyz',
      () => api.readiness(),
      (value) => normalizeHealthStatus(value, 'readiness') === 'ready',
    ),
    runDiagnostic(
      'GET /openapi.yaml',
      () => api.openApiDocument(),
      (value) => typeof value === 'string' && /openapi:\s*3\.1\.0/.test(value),
    ),
    runDiagnostic(
      'GET /api/v2/capabilities',
      () => api.capabilities(),
      (value) => Boolean(value && typeof value === 'object'),
    ),
    runDiagnostic(
      'GET /api/v2/stats',
      () => api.stats(),
      (value) => Boolean(value && typeof value === 'object'),
    ),
    runDiagnostic(
      'GET /api/v2/metrics',
      () => api.metrics(),
      (value) => typeof value === 'string' && value.includes('# TYPE'),
    ),
    runDiagnostic(
      'GET /api/v2/jobs',
      () => api.listJobs({ limit: 1 }),
      (value) => Array.isArray(value?.items),
    ),
  ];
  if (selectedJob) {
    checks.push(
      runDiagnostic(
        'GET /api/v2/jobs/{id}',
        () => api.getJob(selectedJob.id),
        (value) => value?.id === selectedJob.id,
      ),
    );
    checks.push(
      runDiagnostic(
        'GET /api/v2/jobs/{id}/results',
        () => api.listResults(selectedJob.id, { limit: 1 }),
        (value) => Array.isArray(value?.items),
      ),
    );
  } else {
    checks.push(
      Promise.resolve(
        diagnosticResult('GET /api/v2/jobs/{id}', 'skipped', 'No job is available to inspect.'),
      ),
    );
    checks.push(
      Promise.resolve(
        diagnosticResult(
          'GET /api/v2/jobs/{id}/results',
          'skipped',
          'No job is available to inspect.',
        ),
      ),
    );
  }
  const diagnostics = await Promise.all(checks);
  const failures = diagnostics.filter((item) => item.status === 'fail');
  store.setState((previous) => ({
    ...previous,
    diagnostics,
    dataStates: { ...previous.dataStates, diagnostics: failures.length ? 'error' : 'ready' },
    errors: {
      ...previous.errors,
      diagnostics: failures.length ? `${failures.length} read-only check(s) failed.` : null,
    },
  }));
  appendAudit(
    'API diagnostics completed',
    `${diagnostics.length - failures.length}/${diagnostics.length} checks passed or were skipped.`,
    failures.length ? 'warning' : 'success',
  );
  toast(
    failures.length
      ? `${failures.length} read-only API check(s) failed`
      : 'All applicable read-only API checks passed',
    failures.length ? 'warning' : 'success',
  );
}

function openSettings() {
  const state = store.getState();
  previousFocus = document.activeElement;
  elements.settingsForm.elements.demoMode.checked = state.demoMode;
  elements.settingsForm.elements.apiBaseUrl.value = state.connection.apiBaseUrl;
  elements.settingsForm.elements.tenantId.value = state.connection.tenantId;
  elements.tokenField.hidden = !config.allowDevelopmentToken;
  if (config.allowDevelopmentToken) {
    elements.settingsForm.elements.developmentToken.value = developmentToken() || '';
  }
  elements.settingsWriteState.textContent = state.writeControlsEnabled
    ? 'Enabled by immutable dashboard configuration'
    : 'Locked by deployment configuration';
  elements.settingsDialog.showModal();
}

function validateApiBaseUrl(raw) {
  const value = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (!value) return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('API base URL must use HTTP or HTTPS.');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('Remote API base URLs must use HTTPS.');
  if (url.username || url.password) throw new Error('API base URLs cannot include credentials.');
  return value;
}

async function saveSettings() {
  const formData = new FormData(elements.settingsForm);
  let apiBaseUrl;
  try {
    apiBaseUrl = validateApiBaseUrl(formData.get('apiBaseUrl'));
  } catch (error) {
    toast(errorMessage(error), 'danger');
    return;
  }
  const connection = {
    demoMode: formData.get('demoMode') === 'on',
    apiBaseUrl,
    tenantId: String(formData.get('tenantId') || '').trim(),
  };
  saveSessionConnection(connection);
  if (config.allowDevelopmentToken) {
    const token = String(formData.get('developmentToken') || '').trim();
    if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    else sessionStorage.removeItem(SESSION_TOKEN_KEY);
  }
  api = createApiClient({
    apiBaseUrl: connection.apiBaseUrl,
    tenantId: connection.tenantId,
    authMode: config.authMode,
  });
  const snapshot = connection.demoMode ? createDemoSnapshot() : null;
  store.setState((state) => ({
    ...state,
    ...(snapshot || { jobs: [], results: [], reviews: [], deliveries: [] }),
    stats: snapshot ? normalizeStats(snapshot.stats, snapshot.jobs) : normalizeStats({}, []),
    capabilities: snapshot
      ? normalizeCapabilities(snapshot.capabilities)
      : normalizeCapabilities({}),
    demoMode: connection.demoMode,
    connection: {
      apiBaseUrl: connection.apiBaseUrl,
      tenantId: connection.tenantId,
      authMode: config.authMode,
    },
    health: connection.demoMode ? 'healthy' : 'unknown',
    readiness: connection.demoMode ? 'ready' : 'unknown',
    lastUpdated: null,
    drawer: null,
    selectedResultJobId: snapshot?.jobs.find((job) => job.status === 'completed')?.id || null,
    nextJobCursor: null,
    nextResultCursor: null,
    diagnostics: [],
    importPreview: null,
    draftSeedUrls: '',
    dataStates: {
      dashboard: connection.demoMode ? 'ready' : 'idle',
      jobs: connection.demoMode ? 'ready' : 'idle',
      results: connection.demoMode ? 'ready' : 'idle',
      diagnostics: 'idle',
      drawer: 'idle',
      command: 'idle',
      import: 'idle',
    },
    errors: {
      dashboard: null,
      jobs: null,
      results: null,
      diagnostics: null,
      drawer: null,
      command: null,
      import: null,
    },
  }));
  elements.settingsDialog.close();
  appendAudit(
    'Connection settings updated',
    connection.demoMode ? 'Design preview enabled.' : 'Configured API mode enabled.',
    'neutral',
  );
  toast('Session connection updated', 'success');
  if (!connection.demoMode) await refreshDashboard();
}

function openMobileNavigation() {
  document.body.classList.add('mobile-nav-open');
  elements.mobileMenu.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => elements.navigation.querySelector('a')?.focus());
}

function closeMobileNavigation() {
  document.body.classList.remove('mobile-nav-open');
  elements.mobileMenu.setAttribute('aria-expanded', 'false');
}

function restoreInputFocus(selector, value) {
  requestAnimationFrame(() => {
    const input = elements.view.querySelector(selector);
    input?.focus();
    input?.setSelectionRange?.(value.length, value.length);
  });
}

function handleClick(event) {
  const target = event.target.closest(
    '[data-refresh], [data-open-job], [data-open-result], [data-close-drawer], [data-copy], [data-cancel-job], [data-retry-job], [data-view-results], [data-export-results], [data-open-settings], [data-load-more-jobs], [data-load-more-results], [data-clear-job-filters], [data-clear-result-filters], [data-refresh-results], [data-run-diagnostics], [data-apply-import], [data-clear-import], [data-reset-crawl], [data-throughput-range], [data-open-mobile-nav], [data-close-mobile-nav]',
  );
  if (!target) return;

  if (target.matches('[data-refresh]')) void refreshDashboard();
  else if (target.matches('[data-open-job]')) openJob(target.dataset.openJob);
  else if (target.matches('[data-open-result]')) openResult(target.dataset.openResult);
  else if (target.matches('[data-close-drawer]')) closeDrawer();
  else if (target.matches('[data-copy]')) void copyText(target.dataset.copy);
  else if (target.matches('[data-cancel-job]')) void cancelJob(target.dataset.cancelJob);
  else if (target.matches('[data-retry-job]')) void retryJob(target.dataset.retryJob);
  else if (target.matches('[data-view-results]')) {
    event.preventDefault();
    const jobId = target.dataset.viewResults;
    store.setState((state) => ({
      ...state,
      selectedResultJobId: jobId,
      drawer: null,
      route: 'results',
    }));
    location.hash = '#/results';
    void loadResults(jobId);
  } else if (target.matches('[data-export-results]'))
    exportResults(target.dataset.exportResults || 'json');
  else if (target.matches('[data-open-settings]')) openSettings();
  else if (target.matches('[data-load-more-jobs]')) void loadMoreJobs();
  else if (target.matches('[data-load-more-results]'))
    void loadResults(store.getState().selectedResultJobId, { append: true });
  else if (target.matches('[data-clear-job-filters]')) {
    store.setState((state) => ({
      ...state,
      jobFilters: { search: '', status: '', sort: 'updated-desc' },
    }));
  } else if (target.matches('[data-clear-result-filters]')) {
    store.setState((state) => ({
      ...state,
      resultFilters: { search: '', minConfidence: 0, contact: 'any' },
    }));
  } else if (target.matches('[data-refresh-results]')) {
    void loadResults(store.getState().selectedResultJobId);
  } else if (target.matches('[data-run-diagnostics]')) void runDiagnostics();
  else if (target.matches('[data-apply-import]')) applyImport();
  else if (target.matches('[data-clear-import]')) clearImport();
  else if (target.matches('[data-reset-crawl]')) {
    store.setState((state) => ({ ...state, importPreview: null, draftSeedUrls: '' }));
  } else if (target.matches('[data-throughput-range]')) {
    const range = target.dataset.throughputRange;
    store.setState((state) => ({
      ...state,
      throughputRange: range,
      throughput: state.demoMode ? demoThroughput(range) : state.throughput,
    }));
  } else if (target.matches('[data-open-mobile-nav]')) openMobileNavigation();
  else if (target.matches('[data-close-mobile-nav]')) closeMobileNavigation();
}

function handleInput(event) {
  if (event.target.matches('[data-job-search]')) {
    const value = event.target.value;
    store.setState((state) => ({ ...state, jobFilters: { ...state.jobFilters, search: value } }));
    restoreInputFocus('[data-job-search]', value);
  } else if (event.target.matches('[data-result-search]')) {
    const value = event.target.value;
    store.setState((state) => ({
      ...state,
      resultFilters: { ...state.resultFilters, search: value },
    }));
    restoreInputFocus('[data-result-search]', value);
  } else if (event.target.name === 'seedUrls') {
    store.setState((state) => ({ ...state, draftSeedUrls: event.target.value }));
    restoreInputFocus('textarea[name="seedUrls"]', event.target.value);
  }
}

function handleChange(event) {
  if (event.target.matches('[data-job-status]')) {
    store.setState((state) => ({
      ...state,
      jobFilters: { ...state.jobFilters, status: event.target.value },
    }));
  } else if (event.target.matches('[data-job-sort]')) {
    store.setState((state) => ({
      ...state,
      jobFilters: { ...state.jobFilters, sort: event.target.value },
    }));
  } else if (event.target.matches('[data-result-job]')) {
    void loadResults(event.target.value);
  } else if (event.target.matches('[data-result-confidence]')) {
    store.setState((state) => ({
      ...state,
      resultFilters: { ...state.resultFilters, minConfidence: Number(event.target.value) },
    }));
  } else if (event.target.matches('[data-result-contact]')) {
    store.setState((state) => ({
      ...state,
      resultFilters: { ...state.resultFilters, contact: event.target.value },
    }));
  } else if (event.target.matches('[data-import-file]')) {
    void parseImportFile(event.target.files?.[0]);
  }
}

function handleSubmit(event) {
  if (event.target.matches('[data-crawl-form]')) {
    event.preventDefault();
    void submitCrawl(event.target);
  }
}

function drawerFocusables() {
  return [
    ...elements.drawer.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hasAttribute('hidden'));
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    closeDrawer();
    closeMobileNavigation();
    return;
  }
  if (event.key !== 'Tab' || !store.getState().drawer) return;
  const focusable = drawerFocusables();
  if (!focusable.length) {
    event.preventDefault();
    elements.drawer.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleDragOver(event) {
  const dropzone = event.target.closest('[data-import-dropzone]');
  if (!dropzone) return;
  event.preventDefault();
  dropzone.classList.add('is-dragging');
}

function handleDragLeave(event) {
  const dropzone = event.target.closest('[data-import-dropzone]');
  dropzone?.classList.remove('is-dragging');
}

function handleDrop(event) {
  const dropzone = event.target.closest('[data-import-dropzone]');
  if (!dropzone) return;
  event.preventDefault();
  dropzone.classList.remove('is-dragging');
  void parseImportFile(event.dataTransfer?.files?.[0]);
}

window.addEventListener('hashchange', () => {
  closeMobileNavigation();
  const route = routeFromHash();
  store.setState((state) => ({ ...state, route }));
  if (route === 'results' && store.getState().selectedResultJobId && !store.getState().demoMode) {
    void loadResults(store.getState().selectedResultJobId, { quiet: true });
  }
  requestAnimationFrame(() => elements.view.focus());
});

document.addEventListener('click', handleClick);
document.addEventListener('input', handleInput);
document.addEventListener('change', handleChange);
document.addEventListener('submit', handleSubmit);
document.addEventListener('keydown', handleKeydown);
document.addEventListener('dragover', handleDragOver);
document.addEventListener('dragleave', handleDragLeave);
document.addEventListener('drop', handleDrop);
elements.drawerOverlay.addEventListener('click', closeDrawer);

elements.settingsForm.addEventListener('submit', (event) => {
  if (event.submitter?.matches('[data-save-settings]')) {
    event.preventDefault();
    void saveSettings();
  }
});

elements.settingsDialog.addEventListener('close', () => {
  requestAnimationFrame(() => previousFocus?.focus?.());
});

store.subscribe(render);
if (!location.hash) history.replaceState(null, '', '#/overview');
render(store.getState());
if (store.getState().demoMode) refreshDemo();
else void refreshDashboard();
