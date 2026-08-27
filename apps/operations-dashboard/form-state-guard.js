(() => {
  const VIEW_SELECTOR = '#view';
  const FORM_SELECTOR = '[data-crawl-form]';
  const EXCLUDED_TYPES = new Set(['file', 'submit', 'reset', 'button']);
  let snapshot = [];
  let renderIntent = 'restore';
  let restoreQueued = false;

  function crawlForm() {
    return document.querySelector(`${VIEW_SELECTOR} ${FORM_SELECTOR}`);
  }

  function capture(form = crawlForm()) {
    if (!form) return;
    snapshot = [...form.elements]
      .filter((field) => field.name && !EXCLUDED_TYPES.has(field.type))
      .map((field) => ({
        name: field.name,
        type: field.type,
        value: field.value,
        checked: Boolean(field.checked),
      }));
  }

  function restore(form, intent) {
    if (!form || intent === 'reset') return;
    for (const saved of snapshot) {
      if (intent === 'merge-import' && saved.name === 'seedUrls') continue;
      const candidates = [...form.elements].filter(
        (field) => field.name === saved.name && field.type === saved.type,
      );
      const field =
        candidates.find((candidate) => candidate.value === saved.value) || candidates[0];
      if (!field) continue;
      if (field.type === 'checkbox' || field.type === 'radio') field.checked = saved.checked;
      else field.value = saved.value;
    }
  }

  function scheduleRestore() {
    if (restoreQueued) return;
    restoreQueued = true;
    queueMicrotask(() => {
      restoreQueued = false;
      const form = crawlForm();
      const intent = renderIntent;
      renderIntent = 'restore';
      if (intent === 'reset') snapshot = [];
      else {
        restore(form, intent);
        capture(form);
      }
    });
  }

  document.addEventListener(
    'input',
    (event) => {
      if (event.target.closest?.(FORM_SELECTOR)) capture(event.target.form);
    },
    true,
  );

  document.addEventListener(
    'change',
    (event) => {
      if (event.target.closest?.(FORM_SELECTOR)) capture(event.target.form);
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target.closest?.('[data-apply-import], [data-reset-crawl]');
      if (!target) return;
      capture(target.closest('form') || crawlForm());
      renderIntent = target.matches('[data-apply-import]') ? 'merge-import' : 'reset';
    },
    true,
  );

  const view = document.querySelector(VIEW_SELECTOR);
  if (view) {
    new MutationObserver(scheduleRestore).observe(view, {
      childList: true,
      subtree: true,
    });
  }

  if (new URLSearchParams(location.search).get('browser-smoke') === '1') {
    window.addEventListener(
      'load',
      () => {
        setTimeout(() => {
          void import('./browser-smoke.js')
            .then(({ runBrowserSmoke }) => runBrowserSmoke())
            .catch((error) => {
              const marker = document.createElement('pre');
              marker.id = 'browser-smoke-result';
              marker.textContent = `BROWSER_SMOKE=FAIL\n${
                error instanceof Error ? error.stack || error.message : String(error)
              }`;
              document.body.append(marker);
              document.documentElement.dataset.browserSmoke = 'fail';
            });
        }, 0);
      },
      { once: true },
    );
  }
})();
