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
  return new Set(
    [...document.querySelectorAll('[data-open-result]')].map((element) => element.dataset.openResult),
  ).size;
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
    assert(document.querySelector('#job-drawer')?.textContent.includes('manual-smoke.example'), 'new crawl simulation uses submitted targets');
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
      () => document.querySelectoŠ	ÈÚ›Ø‹Y˜]Ù\‰ÊOË™Ù]]šX]J	Ø\šXKZY[‰ÊHOOH	Ù˜[ÙIËˆ	Ü™\Ý[˜]Ù\‰Ëˆ
NÂˆ\ÜÙ\
ØÝ[Y[œ]Y\žTÙ[XÝÜŠ	ÈÚ›Ø‹Y˜]Ù\‰ÊOË^ÛÛ[š[˜ÛY\Ê	Ñ]šY[˜ÙIÊK	Ü™\Ý[˜]Ù\ˆ™[™\œÈ]šY[˜ÙHÝ]IÊNÂˆÛXÚÊ	ÖÙ]KXÛÜÙKY˜]Ù\—IË	ØÛÜÙH™\Ý[˜]Ù\‰ÊNÂ‚ˆÛXÚÊ	ÖÙ]KXÛX\‹\™\Ý[Yš[\œ×IË	ØÛX\ˆ™\Ý[š[\œÈYØZ[‰ÊNÂˆ]ØZ]ØZ]
Ì
NÂˆÛÛœÝ[˜ÚÜÛXÚÈHS[˜ÚÜ‘[[Y[œ›ÝÝ\K˜ÛXÚÎÂˆ]^ÜšYÙÙ\™YH˜[ÙNÂˆS[˜ÚÜ‘[[Y[œ›ÝÝ\K˜ÛXÚÈH[˜Ý[Ûˆ[\˜Ù\YÝÛ›ØY

HÂˆ^ÜšYÙÙ\™YHYNÂˆNÂˆžHÂˆÛXÚÊ	ÖÙ]KY^Ü\™\Ý[ÏH˜ÜÝˆ—IË	ÐÔÕˆ^Ü	ÊNÂˆHš[˜[HÂˆS[˜ÚÜ‘[[Y[œ›ÝÝ\K˜ÛXÚÈH[˜ÚÜÛXÚÎÂˆBˆ\ÜÙ\
^ÜšYÙÙ\™Y	Ýš\ÚX›K\™\Ý[ÔÕˆ^Ü\ÈšYÙÙ\™Y	ÊNÂ‚ˆÙ]˜[YJØÝ[Y[œ]Y\žTÙ[XÝÜŠ	ÖÙ]K\™\Ý[\ÙX\˜ÚIÊK	ÙYš[š][K[›Ý\™\Ù[	ÊNÂˆ]ØZ]ØZ]
Ì
NÂˆ\ÜÙ\
ØÝ[Y[œ]Y\žTÙ[XÝÜŠ	Ë™[\K\Ý]IÊOË^ÛÛ[š[˜ÛY\Ê	Ó›ÈX]Ú[™È™\Ý[ÉÊK	Ù[\Hš[\™YÝ]H™[™\œÉÊNÂˆ™XÛÜ™ÚXÚÊÚXÚÜË	Ü™\Ý[\ÙX\˜ÚYš[\‹Y˜]Ù\‹Y^ÜY[\IÊNÂ‚ˆ]ØZ]›Ý]J	Ú[YÜ˜][ÛœÉÊNÂˆÛXÚÊ	ÖÙ]K\[‹YXYÛ›ÜÝXÜ×IË	Ü[ˆXYÛ›ÜÝXÜÉÊNÂˆ]ØZ]ØZ]›ÜŠ

HOˆØÝ[Y[œ]Y\žTÙ[XÝÜ[
	Ë™XYÛ›ÜÝXËXØ\™	ÊK›[™ÝOOHL	ÙXYÛ›ÜÝXÈØ\™ÉÊNÂˆ\ÜÙ\
ˆË‹‹™ØÝ[Y[œ]Y\žTÙ[XÝÜ[
	Ë™XYÛ›ÜÝXËXØ\™	ÊWK™]™\žJ
Ø\™
HOˆØ\™^ÛÛ[š[˜ÛY\Ê	ÜÚÚ\Y	ÊJKˆ	Ù[[ÈXYÛ›ÜÝXÜÈ™[XZ[ˆ^XÚ]HÚÚ\Y	Ëˆ
NÂˆ™XÛÜ™ÚXÚÊÚXÚÜË	ÙXYÛ›ÜÝXÜËY]K\Ý]\ÉÊNÂ‚ˆÛXÚÊ	ÖÙ]K[Ü[‹\Ù][™Ü×IË	ÛÜ[ˆÙ][™ÜÉÊNÂˆ]ØZ]ØZ]›ÜŠ

HOˆØÝ[Y[œ]Y\žTÙ[XÝÜŠ	ÈÜÙ][™ÜËYX[ÙÉÊOË›Ü[‹	ÜÙ][™ÜÈX[ÙÉÊNÂˆ\ÜÙ\
ØÝ[Y[œ]Y\žTÙ[XÝÜŠ	ÈÜÙ][™ÜË]Üš]K\Ý]IÊOË^ÛÛ[š[˜ÛY\Ê	ÓØÚÙY	ÊK	ÜÙ][™ÜÈ™\ÜÈØÚÙYÜš]\ÉÊNÂˆØÝ[Y[œ]Y\žTÙ[XÝÜŠ	ÈÜÙ][™ÜËYX[ÙÉÊK˜ÛÜÙJ
NÂˆ™XÛÜ™ÚXÚÊÚXÚÜË	ÜÙ][™ÜËYX[ÙÉÊNÂ‚ˆX\šÙ\‹^ÛÛ[H”“ÕÔÑT—ÔÓSÒÑOTTÔ×ÒPÒÔÏIØÚXÚÜËš›Ú[Š	Ë	Ê_XÂˆØÝ[Y[™ØÝ[Y[[[Y[™]\Ù]˜œ›ÝÜÙ\”Û[ÚÙHH	Ü\ÜÉÎÂˆHØ]Ú
\œ›ÜŠHÂˆX\šÙ\‹^ÛÛ[H”“ÕÔÑT—ÔÓSÒÑOQRS‰Ù\œ›Üˆ[œÝ[˜Ù[Ùˆ\œ›ÜˆÈ\œ›Ü‹œÝXÚÈ\œ›Ü‹›Y\ÜØYÙHˆÝš[™Ê\œ›ÜŠ_XÂˆØÝ[Y[™ØÝ[Y[[[Y[™]\Ù]˜œ›ÝÜÙ\”Û[ÚÙHH	Ù˜Z[	ÎÂˆB‚ˆØÝ[Y[˜›ÙK˜\[™
X\šÙ\ŠNÂŸB