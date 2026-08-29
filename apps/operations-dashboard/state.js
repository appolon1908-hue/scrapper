export const JOB_STATUS = Object.freeze({
  queued: { label: 'Queued', tone: 'neutral', terminal: false },
  running: { label: 'Running', tone: 'info', terminal: false },
  completed: { label: 'Completed', tone: 'success', terminal: true },
  failed: { label: 'Failed', tone: 'danger', terminal: true },
  cancel_requested: { label: 'Cancelling', tone: 'warning', terminal: false },
  cancelled: { label: 'Cancelled', tone: 'muted', terminal: true },
});

export function statusMeta(status) {
  return (
    JOB_STATUS[status] || {
      label: String(status || 'Unknown'),
      tone: 'muted',
      terminal: false,
    }
  );
}

export function createStore(initialState) {
  let state = structuredClone(initialState);
  const listeners = new Set();

  return Object.freeze({
    getState() {
      return state;
    },
    setState(update) {
      const next = typeof update === 'function' ? update(state) : { ...state, ...update };
      state = next;
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export function progressPercent(job) {
  if (!job) return 0;
  if (job.status === 'completed') return 100;
  if (job.status === 'queued') return 0;

  const progress = job.progress || {};
  const payload = job.payload || {};
  const processed = Number(progress.pagesProcessed ?? progress.pages_processed ?? 0);
  const pageTarget = Number(payload.maxPages ?? payload.max_pages ?? 0);
  const companies = Number(progress.companiesResolved ?? progress.companies_resolved ?? 0);
  const companyTarget = Number(payload.maxCompanies ?? payload.max_companies ?? 0);

  const pageRatio = pageTarget > 0 ? processed / pageTarget : 0;
  const companyRatio = companyTarget > 0 ? companies / companyTarget : 0;
  return Math.max(0, Math.min(99, Math.round(Math.max(pageRatio, companyRatio) * 100)));
}

export function summarizeJobs(jobs = []) {
  const counts = {
    total: jobs.length,
    active: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const job of jobs) {
    if (job.status in counts) counts[job.status] += 1;
    if (['queued', 'running', 'cancel_requested'].includes(job.status)) counts.active += 1;
  }

  const terminal = counts.completed + counts.failed + counts.cancelled;
  return {
    ...counts,
    successRate: terminal > 0 ? Math.round((counts.completed / terminal) * 100) : 0,
  };
}

export function formatNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(number);
}

export function formatDateTime(value) {
  if (!value) return 'Not started';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatRelativeTime(value, now = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const seconds = Math.round((date.getTime() - now) / 1000);
  const ranges = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, divisor] of ranges) {
    if (Math.abs(seconds) >= divisor) {
      return formatter.format(Math.round(seconds / divisor), unit);
    }
  }
  return formatter.format(seconds, 'second');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function shortId(value, size = 8) {
  const text = String(value || '');
  return text.length > size ? text.slice(0, size) : text;
}

export function getJobTitle(job) {
  const seed = job?.payload?.seedUrls?.[0] || job?.payload?.seed_urls?.[0];
  if (!seed) return `Crawl ${shortId(job?.id)}`;
  try {
    return new URL(seed).hostname.replace(/^www\./, '');
  } catch {
    return seed;
  }
}
