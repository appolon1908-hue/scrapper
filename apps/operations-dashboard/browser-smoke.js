function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, label, timeoutMs = 5_000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await wait(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function assert(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
}

function setValue(element, value, eventName = 'input') {
  element.value = value;
  element.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function click(selector, label = selector) {
  const element = document.querySelector(selector);
  assert(element, `${label} exists`);
  element.click();
  return element;
}

async function route(name) {
  location.hash = `#/${name}`;
  await waitFor(
    () => document.querySelector('#topbar-title')?.textContent?.trim() !== '',
    `${name} route title`,
  );
  await wait(30);
}

function rowCount() {
  return document.querySelectorAll('[data-job-row]').length;
}

function resultCount() {
  return document.querySelectorAll('[data-open-result]').length;
}

function recordCheck(checks, label) {
  checks.push(label);
}

export async function runBrowserSmoke() {
  const checks = [];
  const marker = document.createElement('pre');
  marker.id = 'browser-smoke-result';
  marker.hidden = false;

  try {
    await waitFor(() => document.querySelector('#view h1'), 'initial dashboard render');
    assert(document.querySelector('#topbar-title')?.textContent === 'Overview', 'overview renders');
    recordCheck(checks, 'overview');

    await route('jobs');
    const originalJobCount = rowCount();
    assert(originalJobCount >= 5, 'demo jobs render');

    const jobSearch = document.querySelector('[data-job-search]');
    setValue(jobSearch, 'northstar');
    await wait(30);
    assert(rowCount() === 1, 'job search filters rows');

    click('[data-clear-job-filters]', 'clear job filters');
    await wait(30);
    assert(rowCount() === originalJobCount, 'job filters clear');

    const statusSelect = document.querySelector('[data-job-status]');
    setValue(statusSelect, 'failed', 'change');
    await wait(30);
    assert(rowCount() === 1, 'job status filter works');
    assert(document.querySelector('[data-job-row]')?.textContent.includes('Failed'), 'failed row rendered');

    click('[data-open-job]', 'open job drawer');
    await waitFor(
      () => document.querySelector('#job-drawer')?.getAttribute('aria-hidden') === 'false',
      'job drawer',
    );
    assert(document.querySelector('#job-drawer')?.textContent.includes('Seed targets'), 'job drawer details render');
    click('[data-close-drawer]', 'close job drawer');
    await waitFor(
      () => document.querySelector('#job-drawer')?.getAttribute('aria-hidden') === 'true',
      'closed job drawer',
    );
    recordCheck(checks, 'job-search-filter-drawer');

    await route('new-crawl');
    const profile = document.querySelector('select[name="profile"]');
    setValue(profile, 'contacts', 'change');
    const seedUrls = document.querySelector('textarea[name="seedUrls"]');
    setValue(seedUrls, 'https://manual-smoke.example/');
    await wait(30);
    assert(document.querySelector('select[name="profile"]').value === 'contacts', 'typing seed URLs preserves other form state');

    const fileInput = document.querySelector('[data-import-file]');
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        ['business_name,website\nSmoke One,smoke-one.example\nSmoke Duplicate,https://smoke-one.example/\n'],
        'smoke-companies.csv',
        { type: 'text/csv' },
      ),
    );
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.querySelector('[data-apply-import]'), 'import preview');
    assert(document.querySelector('.import-preview')?.textContent.includes('1 valid websites'), 'import preview summarizes valid URL');
    click('[data-apply-import]', 'apply import');
    await wait(30);
    assert(
      document.querySelector('textarea[name="seedUrls"]').value.includes('https://smoke-one.example/'),
      'import applies to targets',
    );
    assert(
      document.querySelector('select[name="profile"]').value === 'contacts',
      'import preview and apply preserve other crawl-form fields',
    );

    const crawlForm = document.querySelector('[data-crawl-form]');
    crawlForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => location.hash === '#/jobs', 'crawl simulation route');
    await waitFor(
      () => document.querySelector('#job-drawer')?.getAttribute('aria-hidden') === 'false',
      'new crawl drawer',
    );
    assert(
      document.querySelector('#job-drawer')?.textContent.includes('manual-smoke.example'),
      'new crawl simulation uses submitted targets',
    );
    click('[data-close-drawer]', 'close new crawl drawer');
    recordCheck(checks, 'import-form-submit');

    await route('results');
    const originalResults = resultCount();
    assert(originalResults >= 3, 'demo results render');
    const resultSearch = document.querySelector('[data-result-search]');
    setValue(resultSearch, 'fleet');
    await wait(30);
    assert(resultCount() === 1, 'result search filters records');

    click('[data-clear-result-filters]', 'clear result filters');
    await wait(30);
    const contactSelect = document.querySelector('[data-result-contact]');
    setValue(contactSelect, 'phone', 'change');
    await wait(30);
    assert(resultCount() === 2, 'result contact filter works');

    click('[data-open-result]', 'open result drawer');
    await waitFor(
      () => document.querySelector('#job-drawer')?.getAttribute('aria-hidden') === 'false',
      'result drawer',
    );
    assert(document.querySelector('#job-drawer')?.textContent.includes('Evidence'), 'result drawer renders evidence state');
    click('[data-close-drawer]', 'close result drawer');

    click('[data-clear-result-filters]', 'clear result filters again');
    await wait(30);
    const anchorClick = HTMLAnchorElement.prototype.click;
    let exportTriggered = false;
    HTMLAnchorElement.prototype.click = function interceptedDownload() {
      exportTriggered = true;
    };
    try {
      click('[data-export-results="csv"]', 'CSV export');
    } finally {
      HTMLAnchorElement.prototype.click = anchorClick;
    }
    assert(exportTriggered, 'visible-result CSV export is triggered');

    setValue(document.querySelector('[data-result-search]'), 'definitely-not-present');
    await wait(30);
    assert(document.querySelector('.empty-state')?.textContent.includes('No matching results'), 'empty filtered state renders');
    recordCheck(checks, 'result-search-filter-drawer-export-empty');

    await route('integrations');
    click('[data-run-diagnostics]', 'run diagnostics');
    await waitFor(() => document.querySelectorAll('.diagnostic-card').length === 10, 'diagnostic cards');
    assert(
      [...document.querySelectorAll('.diagnostic-card')].every((card) => card.textContent.includes('skipped')),
      'demo diagnostics remain explicitly skipped',
    );
    recordCheck(checks, 'diagnostics-data-states');

    click('[data-open-settings]', 'open settings');
    await waitFor(() => document.querySelector('#settings-dialog')?.open, 'settings dialog');
    assert(document.querySelector('#settings-write-state')?.textContent.includes('Locked'), 'settings reports locked writes');
    document.querySelector('#settings-dialog').close();
    recordCheck(checks, 'settings-dialog');

    marker.textContent = `BROWSER_SMOKE=PASS\nCHECKS=${checks.join(',')}`;
    document.documentElement.dataset.browserSmoke = 'pass';
  } catch (error) {
    marker.textContent = `BROWSER_SMOKE=FAIL\n${error instanceof Error ? error.stack || error.message : String(error)}`;
    document.documentElement.dataset.browserSmoke = 'fail';
  }

  document.body.append(marker);
}
