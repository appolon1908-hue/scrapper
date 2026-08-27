import { ApiError, DashboardApiClient, newCommandId } from './api-client.js';
import { navigation, renderJobDrawer, renderNavigation, renderRoute } from './components.js';
import { createDemoSnapshot } from './mock-data.js';
import { createStore, getJobTitle } from './state.js';

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
  ...(globalThis.CODESTRA_DASHBOARD_CONFIG || {}),
});

const SESSION_CONNECTION_KEY = 'codestra.dashboard.connection.v1';
const SESSION_TOKEN_KEY = 'codestra.dashboard.development-token.v1';
const MAX_AUDIT_EVENTS = 80;
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

const sessionConnection = readSessionConnection();
const demoSnapshot = createDemoSnapshot();
const initialRoute = routeFromHash();
const initialState = {
  route: initialRoute,
  ...demoSnapshot,
  demoMode: sessionConnection.demoMode ?? Boolean(config.demoMode),
  writeControlsEnabled: Boolean(config.writeControlsEnabled),
  connection: {
    apiBaseUrl: sessionConnection.apiBaseUrl ?? String(config.apiBaseUrl || ''),
    tenantId: sessionConnection.tenantId ?? String(config.tenantId || ''),
    authMode: String(config.authMode || 'same-origin'),
  },
  health: 'unknown',
  readiness: 'unknown',
  loading: false,
  error: null,
  lastUpdated: null,
  selectedJobId: null,
  selectedResultJobId: demoSnapshot.jobs.find((job) => job.status === 'completed')?.id || null,
  nextJobCursor: null,
  throughput: null,
  jobFilters: { search: '', status: '' },
  auditEvents: [
    auditEvent(
      'Dashboard initialized',
      config.demoMode ? 'Safe design preview loaded.' : 'Configured connection loaded.',
      'success',
    ),
  ],
};

const store = createStore(initialState);
let api = createApiClient(initialState.connection);
let autoRefreshTimer = null;
let previousFocus = null;

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

function setLoading(loading) {
  store.setState((state) => ({ ...state, loading }));
}

function toast(message, tone = 'neutral', timeout = 4200) {
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
  elements.drawer.innerHTML = renderJobDrawer(
    state.jobs.find((job) => job.id === state.selectedJobId),
    state,
  );

  const drawerOpen = Boolean(state.selectedJobId);
  elements.drawer.setAttribute('aria-hidden', String(!drawerOpen));
  document.body.classList.toggle('drawer-open', drawerOpen);
  elements.loadingOverlay.setAttribute('aria-hidden', String(!state.loading));
  document.body.classList.toggle('is-loading', state.loading);

  const title = routeLabels.get(state.route) || 'Overview';
  elements.topbarTitle.textContent = title;
  elements.topbarContext.textContent = state.demoMode ? 'Design preview' : 'Operations';
  document.title = `${title} · Codestra Crawler Control`;

  elements.environmentLabel.textContent = config.environmentLabel;
  elements.environmentDetail.textContent = state.demoMode
    ? 'No live runtime assumed'
    : state.readiness === 'ready'
      ? 'API dependency readiness confirmed'
      : 'Connection not yet verified';

  elements.connectionPill.classList.toggle(
    'connection-pill--online',
    !state.demoMode && state.readiness === 'ready',
  );
  elements.connectionCopy.textContent = state.demoMode
    ? 'Design preview'
    : state.readiness === 'ready'
      ? 'API ready'
      : 'API unverified';

  scheduleAutoRefresh(state);
}

function scheduleAutoRefresh(state) {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  const seconds = Number(config.refreshSeconds || 0);
  if (state.demoMode || seconds < 5) return;
  autoRefreshTimer = setInterval(() => void refreshDashboard({ quiet: true }), seconds * 1000);
}

function refreshDemo() {
  store.setState((state) => {
    const jobs = state.jobs.map((job) => {
      if (job.status !== 'running') return job;
      const progress = { ...(job.progress || {}) };
      const maxPages = Number(job.payload?.maxPages || 250);
      progress.pagesProcessed = Math.min(maxPages, Number(progress.pagesProcessed || 0) + 4);
      progress.companiesResolved = Number(progress.companiesResolved || 0) + 1;
      return {
        ...job,
        progress,
        updated_at: new Date().toISOString(),
      };
    });
    return {
      ...state,
      jobs,
      health: 'healthy',
      readiness: 'ready',
      lastUpdated: new Date().toISOString(),
      error: null,
    };
  });
}

async function refreshDashboard({ quiet = false } = {}) {
  const state = store.getState();
  if (state.loading) return;
  if (!quiet) setLoading(true);

  if (state.demoMode) {
    refreshDemo();
    if (!quiet) toast('Design preview refreshed', 'success');
    setLoading(false);
    return;
  }

  try {
    const [health, readiness, capabilities, stats, jobs] = await Promise.allSettled([
      api.health(),
      api.readiness(),
      api.capabilities(),
      api.stats(),
      api.listJobs({ limit: 100 }),
    ]);

    const failures = [health, readiness, capabilities, stats, jobs].filter(
      (result) => result.status === 'rejected',
    );
    const current = store.getState();
    const nextJobs = jobs.status === 'fulfilled' ? jobs.value.items || [] : current.jobs;
    const nextSelected = nextJobs.some((job) => job.id === current.selectedJobId)
      ? current.selectedJobId
      : null;

    store.setState((previous) => ({
      ...previous,
      health:
        health.status === 'fulfilled' && health.value?.status
          ? String(health.value.status)
          : 'unknown',
      readiness:
        readiness.status === 'fulfilled' && readiness.value?.status
          ? String(readiness.value.status)
          : 'unknown',
      capabilities:
        capabilities.status === 'fulfilled' ? capabilities.value : previous.capabilities,
      stats: stats.status === 'fulfilled' ? stats.value : previous.stats,
      jobs: nextJobs,
      nextJobCursor: jobs.status === 'fulfilled' ? jobs.value.next_cursor || null : null,
      selectedJobId: nextSelected,
      lastUpdated: new Date().toISOString(),
      error: failures.length ? errorMessage(failures[0].reason) : null,
    }));

    if (store.getState().route === 'results') {
      await loadResults(store.getState().selectedResultJobId, { quiet: true });
    }

    if (failures.length) {
      toast(`Dashboard refreshed with ${failures.length} unavailable source(s)`, 'warning');
    } else if (!quiet) {
      toast('Dashboard refreshed from the API', 'success');
    }
  } catch (error) {
    const message = errorMessage(error);
    store.setState((previous) => ({ ...previous, error: message }));
    toast(`Refresh failed: ${message}`, 'danger', 6500);
    appendAudit('Refresh failed', message, 'danger');
  } finally {
    setLoading(false);
  }
}

async function loadMoreJobs() {
  const state = store.getState();
  if (state.demoMode || !state.nextJobCursor) return;
  setLoading(true);
  try {
    const page = await api.listJobs({ limit: 100, cursor: state.nextJobCursor });
    store.setState((previous) => ({
      ...previous,
      jobs: [...previous.jobs, ...(page.items || [])],
      nextJobCursor: page.next_cursor || null,
    }));
    toast('Additional jobs loaded', 'success');
  } catch (error) {
    toast(`Could not load more jobs: ${errorMessage(error)}`, 'danger');
  } finally {
    setLoading(false);
  }
}

async function loadResults(jobId, { quiet = false } = {}) {
  if (!jobId) return;
  const state = store.getState();
  store.setState((previous) => ({ ...previous, selectedResultJobId: jobId }));
  if (state.demoMode) return;
  if (!quiet) setLoading(true);
  try {
    const page = await api.listResults(jobId, { limit: 250, minConfidence: 0 });
    store.setState((previous) => ({ ...previous, results: page.items || [] }));
  } catch (error) {
    store.setState((previous) => ({ ...previous, results: [] }));
    toast(`Could not load job results: ${errorMessage(error)}`, 'danger');
  } finally {
    if (!quiet) setLoading(false);
  }
}

function openJob(jobId) {
  const state = store.getState();
  if (!state.jobs.some((job) => job.id === jobId)) return;
  previousFocus = document.activeElement;
  store.setState((previous) => ({ ...previous, selectedJobId: jobId }));
  requestAnimationFrame(() => elements.drawer.querySelector('[data-close-drawer]')?.focus());
}

function closeDrawer() {
  if (!store.getState().selectedJobId) return;
  store.setState((state) => ({ ...state, selectedJobId: null }));
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
  target.focus?.();
}

function parseCrawlForm(form) {
  const formData = new FormData(form);
  const seedUrls = String(formData.get('seedUrls') || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const uniqueUrls = [...new Set(seedUrls)];

  if (!uniqueUrls.length) throw new Error('Add at least one public HTTP or HTTPS seed URL.');
  if (uniqueUrls.length > 500)
    throw new Error('The dashboard accepts at most 500 seed URLs per command.');

  for (const rawUrl of uniqueUrls) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid URL: ${rawUrl}`);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`Only HTTP and HTTPS targets are allowed: ${rawUrl}`);
    }
    if (url.username || url.password) throw new Error('Seed URLs cannot include credentials.');
  }

  const number = (name) => Number(formData.get(name));
  const payload = {
    seedUrls: uniqueUrls,
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
  const callbackReference = String(formData.get('callbackReference') || '').trim();
  if (callbackReference) payload.callbackReference = callbackReference;

  if (!Number.isInteger(payload.maxPages) || payload.maxPages < 1 || payload.maxPages > 50_000) {
    throw new Error('Max pages must be between 1 and 50,000.');
  }
  if (
    !Number.isInteger(payload.maxCompanies) ||
    payload.maxCompanies < 1 ||
    payload.maxCompanies > 5_000
  ) {
    throw new Error('Max companies must be between 1 and 5,000.');
  }
  if (uniqueUrls.length > payload.maxCompanies) {
    throw new Error('Seed URL count cannot exceed the max-company limit.');
  }
  if (!Number.isInteger(payload.maxDepth) || payload.maxDepth < 0 || payload.maxDepth > 8) {
    throw new Error('Max depth must be between 0 and 8.');
  }
  if (
    !Number.isFinite(payload.requestsPerSecond) ||
    payload.requestsPerSecond < 0.1 ||
    payload.requestsPerSecond > 10
  ) {
    throw new Error('Requests per second must be between 0.1 and 10.');
  }
  if (!/^[A-Z]{2}$/.test(payload.countryCode)) {
    throw new Error('Country code must contain exactly two letters.');
  }

  const state = store.getState();
  if (payload.profile === 'registry' && !state.capabilities?.registry_enrichment) {
    throw new Error('Registry enrichment is not reported as available.');
  }
  if (payload.mode === 'discovery' && !state.capabilities?.discovery) {
    throw new Error('Discovery is not reported as available by this API context.');
  }

  return payload;
}

function demoJob(payload) {
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() || newCommandId(),
    tenant_id: store.getState().connection.tenantId || 'tenant-design-preview',
    correlation_id: newCommandId(),
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
  };
}

async function submitCrawl(form) {
  let payload;
  try {
    payload = parseCrawlForm(form);
  } catch (error) {
    showFormError(errorMessage(error));
    return;
  }

  const state = store.getState();
  if (!state.demoMode && !state.writeControlsEnabled) {
    showFormError('Write controls are locked by deployment configuration.');
    return;
  }

  setLoading(true);
  try {
    let created;
    if (state.demoMode) {
      created = demoJob(payload);
    } else {
      created = await api.createJob(payload, {
        correlationId: newCommandId(),
        idempotencyKey: newCommandId(),
      });
    }

    store.setState((previous) => ({
      ...previous,
      jobs: [created, ...previous.jobs.filter((job) => job.id !== created.id)],
      selectedJobId: created.id,
      route: 'jobs',
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
    showFormError(message);
    appendAudit('Crawl command failed', message, 'danger');
  } finally {
    setLoading(false);
  }
}

async function cancelJob(jobId) {
  const state = store.getState();
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  if (!state.demoMode && !state.writeControlsEnabled) {
    toast('Write controls are locked by deployment configuration', 'warning');
    return;
  }
  if (!globalThis.confirm(`Request cancellation for ${getJobTitle(job)}?`)) return;

  setLoading(true);
  try {
    const updated = state.demoMode
      ? {
          ...job,
          status: job.status === 'queued' ? 'cancelled' : 'cancel_requested',
          updated_at: new Date().toISOString(),
          version: Number(job.version || 0) + 1,
        }
      : await api.cancelJob(jobId);
    replaceJob(updated);
    appendAudit('Cancellation requested', `${getJobTitle(updated)} · ${updated.id}`, 'warning');
    toast('Cancellation request recorded', 'success');
  } catch (error) {
    toast(`Cancellation failed: ${errorMessage(error)}`, 'danger');
  } finally {
    setLoading(false);
  }
}

async function retryJob(jobId) {
  const state = store.getState();
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  if (!state.demoMode && !state.writeControlsEnabled) {
    toast('Write controls are locked by deployment configuration', 'warning');
    return;
  }

  setLoading(true);
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
      : await api.retryJob(jobId);
    replaceJob(updated);
    appendAudit('Retry requested', `${getJobTitle(updated)} · ${updated.id}`, 'success');
    toast('Retry accepted', 'success');
  } catch (error) {
    toast(`Retry failed: ${errorMessage(error)}`, 'danger');
  } finally {
    setLoading(false);
  }
}

function replaceJob(updated) {
  store.setState((state) => ({
    ...state,
    jobs: state.jobs.map((job) => (job.id === updated.id ? updated : job)),
  }));
}

function exportResults() {
  const state = store.getState();
  if (!state.results.length) {
    toast('There are no loaded results to export', 'warning');
    return;
  }
  const payload = {
    exported_at: new Date().toISOString(),
    source: state.demoMode ? 'design-preview' : 'configured-api',
    tenant_id: state.connection.tenantId || null,
    job_id: state.selectedResultJobId,
    record_count: state.results.length,
    notice:
      'This browser export may contain business contact information. Apply approved handling policy.',
    records: state.results,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `codestra-results-${state.selectedResultJobId || 'view'}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  appendAudit('Browser export created', `${state.results.length} visible records`, 'warning');
  toast('Visible results exported to JSON', 'success');
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast('Copied to clipboard', 'success');
  } catch {
    toast('Clipboard access is unavailable', 'warning');
  }
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

async function saveSettings() {
  const formData = new FormData(elements.settingsForm);
  const connection = {
    demoMode: formData.get('demoMode') === 'on',
    apiBaseUrl: String(formData.get('apiBaseUrl') || '')
      .trim()
      .replace(/\/+$/, ''),
    tenantId: String(formData.get('tenantId') || '').trim(),
  };
  if (connection.apiBaseUrl && !/^https?:\/\//.test(connection.apiBaseUrl)) {
    toast('API base URL must use HTTP or HTTPS', 'danger');
    return;
  }
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
    ...(snapshot || {}),
    demoMode: connection.demoMode,
    connection: {
      apiBaseUrl: connection.apiBaseUrl,
      tenantId: connection.tenantId,
      authMode: config.authMode,
    },
    health: connection.demoMode ? 'healthy' : 'unknown',
    readiness: connection.demoMode ? 'ready' : 'unknown',
    lastUpdated: null,
    error: null,
    selectedJobId: null,
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
}

function closeMobileNavigation() {
  document.body.classList.remove('mobile-nav-open');
  elements.mobileMenu.setAttribute('aria-expanded', 'false');
}

function handleClick(event) {
  const target = event.target.closest(
    '[data-refresh], [data-open-job], [data-close-drawer], [data-copy], [data-cancel-job], [data-retry-job], [data-view-results], [data-export-results], [data-open-settings], [data-load-more], [data-open-mobile-nav], [data-close-mobile-nav]',
  );
  if (!target) return;

  if (target.matches('[data-refresh]')) void refreshDashboard();
  if (target.matches('[data-open-job]')) openJob(target.dataset.openJob);
  if (target.matches('[data-close-drawer]')) closeDrawer();
  if (target.matches('[data-copy]')) void copyText(target.dataset.copy);
  if (target.matches('[data-cancel-job]')) void cancelJob(target.dataset.cancelJob);
  if (target.matches('[data-retry-job]')) void retryJob(target.dataset.retryJob);
  if (target.matches('[data-view-results]')) {
    store.setState((state) => ({
      ...state,
      selectedResultJobId: target.dataset.viewResults,
      selectedJobId: null,
    }));
    void loadResults(target.dataset.viewResults);
  }
  if (target.matches('[data-export-results]')) exportResults();
  if (target.matches('[data-open-settings]')) openSettings();
  if (target.matches('[data-load-more]')) void loadMoreJobs();
  if (target.matches('[data-open-mobile-nav]')) openMobileNavigation();
  if (target.matches('[data-close-mobile-nav]')) closeMobileNavigation();
}

function handleInput(event) {
  if (event.target.matches('[data-job-search]')) {
    const value = event.target.value;
    store.setState((state) => ({
      ...state,
      jobFilters: { ...state.jobFilters, search: value },
    }));
    requestAnimationFrame(() => {
      const input = elements.view.querySelector('[data-job-search]');
      input?.focus();
      input?.setSelectionRange(value.length, value.length);
    });
  }
}

function handleChange(event) {
  if (event.target.matches('[data-job-status]')) {
    store.setState((state) => ({
      ...state,
      jobFilters: { ...state.jobFilters, status: event.target.value },
    }));
  }
  if (event.target.matches('[data-result-job]')) {
    void loadResults(event.target.value);
  }
}

function handleSubmit(event) {
  if (event.target.matches('[data-crawl-form]')) {
    event.preventDefault();
    void submitCrawl(event.target);
  }
}

window.addEventListener('hashchange', () => {
  closeMobileNavigation();
  const route = routeFromHash();
  store.setState((state) => ({ ...state, route }));
  requestAnimationFrame(() => elements.view.focus());
});

document.addEventListener('click', handleClick);
document.addEventListener('input', handleInput);
document.addEventListener('change', handleChange);
document.addEventListener('submit', handleSubmit);
elements.drawerOverlay.addEventListener('click', closeDrawer);

elements.settingsForm.addEventListener('submit', (event) => {
  const submitter = event.submitter;
  if (submitter?.matches('[data-save-settings]')) {
    event.preventDefault();
    void saveSettings();
  }
});

elements.settingsDialog.addEventListener('close', () => {
  requestAnimationFrame(() => previousFocus?.focus?.());
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeDrawer();
  closeMobileNavigation();
});

store.subscribe(render);
if (!location.hash) history.replaceState(null, '', '#/overview');
render(store.getState());
if (store.getState().demoMode) refreshDemo();
else void refreshDashboard();
