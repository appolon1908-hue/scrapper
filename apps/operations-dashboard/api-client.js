const JSON_CONTENT_TYPE = 'application/json';
const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status ?? 0;
    this.code = options.code ?? 'request_failed';
    this.requestId = options.requestId ?? null;
    this.details = options.details ?? null;
  }
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function encodeQuery(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item));
    } else {
      query.set(key, String(value));
    }
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

function requestSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    },
  };
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('/json') || contentType.includes('+json')) {
    return response.json().catch(() => ({}));
  }
  return response.text().catch(() => '');
}

export function newCommandId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export class DashboardApiClient {
  constructor(options = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.tenantId = String(options.tenantId || '').trim();
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.getAccessToken = options.getAccessToken ?? (() => null);
    this.credentials = options.credentials ?? 'same-origin';
    this.timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('A fetch implementation is required');
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 120_000) {
      throw new TypeError('timeoutMs must be between 1,000 and 120,000');
    }
  }

  withConnection(options = {}) {
    return new DashboardApiClient({
      baseUrl: options.baseUrl ?? this.baseUrl,
      tenantId: options.tenantId ?? this.tenantId,
      fetchImpl: options.fetchImpl ?? this.fetchImpl,
      getAccessToken: options.getAccessToken ?? this.getAccessToken,
      credentials: options.credentials ?? this.credentials,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    });
  }

  async request(path, options = {}) {
    if (!String(path).startsWith('/')) throw new TypeError('API path must start with /');
    const method = String(options.method ?? 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('accept', options.accept ?? JSON_CONTENT_TYPE);
    if (this.tenantId) headers.set('x-tenant-id', this.tenantId);

    const token = await this.getAccessToken();
    if (token) headers.set('authorization', `Bearer ${token}`);

    let body;
    if (options.body !== undefined) {
      headers.set('content-type', JSON_CONTENT_TYPE);
      body = JSON.stringify(options.body);
    }

    const deadline = requestSignal(options.signal, options.timeoutMs ?? this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        credentials: this.credentials,
        signal: deadline.signal,
        cache: options.cache ?? 'no-store',
      });
    } catch (error) {
      const timedOut = deadline.signal.aborted && !options.signal?.aborted;
      throw new ApiError(timedOut ? 'Request timed out' : error instanceof Error ? error.message : 'Network request failed', {
        code: timedOut ? 'request_timeout' : 'network_error',
      });
    } finally {
      deadline.cleanup();
    }

    const payload = await parseResponse(response);
    if (!response.ok) {
      const errorPayload = typeof payload === 'object' && payload ? payload : {};
      throw new ApiError(errorPayload.error || errorPayload.message || `Request failed with ${response.status}`, {
        status: response.status,
        code: errorPayload.error || 'request_failed',
        requestId: errorPayload.request_id || response.headers.get('x-request-id'),
        details: errorPayload.details ?? payload,
      });
    }
    return payload;
  }

  serviceInfo(options) {
    return this.request('/', options);
  }

  health(options) {
    return this.request('/healthz', options);
  }

  readiness(options) {
    return this.request('/readyz', options);
  }

  openApiDocument(options = {}) {
    return this.request('/openapi.yaml', { ...options, accept: 'application/yaml, text/yaml, text/plain' });
  }

  capabilities(options) {
    return this.request('/api/v2/capabilities', options);
  }

  stats(options) {
    return this.request('/api/v2/stats', options);
  }

  metrics(options = {}) {
    return this.request('/api/v2/metrics', { ...options, accept: 'text/plain' });
  }

  listJobs(query = {}, options = {}) {
    return this.request(`/api/v2/jobs${encodeQuery(query)}`, options);
  }

  getJob(id, options = {}) {
    return this.request(`/api/v2/jobs/${encodeURIComponent(id)}`, options);
  }

  createJob(payload, command = {}, options = {}) {
    return this.createJobAt('/api/v2/jobs', payload, command, options);
  }

  createJobCommand(payload, command = {}, options = {}) {
    return this.createJobAt('/api/v2/commands/crawl', payload, command, options);
  }

  createJobAt(path, payload, command, options) {
    const correlationId = command.correlationId || newCommandId();
    const idempotencyKey = command.idempotencyKey || newCommandId();
    return this.request(path, {
      ...options,
      method: 'POST',
      body: payload,
      headers: {
        ...options.headers,
        'x-correlation-id': correlationId,
        'idempotency-key': idempotencyKey,
      },
    });
  }

  cancelJob(id, command = {}, options = {}) {
    return this.jobCommand(`/api/v2/jobs/${encodeURIComponent(id)}/cancel`, command, options);
  }

  cancelJobCommand(id, command = {}, options = {}) {
    return this.jobCommand(`/api/v2/commands/jobs/${encodeURIComponent(id)}/cancel`, command, options);
  }

  retryJob(id, command = {}, options = {}) {
    return this.jobCommand(`/api/v2/jobs/${encodeURIComponent(id)}/retry`, command, options);
  }

  retryJobCommand(id, command = {}, options = {}) {
    return this.jobCommand(`/api/v2/commands/jobs/${encodeURIComponent(id)}/retry`, command, options);
  }

  jobCommand(path, command, options) {
    return this.request(path, {
      ...options,
      method: 'POST',
      headers: {
        ...options.headers,
        'x-correlation-id': command.correlationId || newCommandId(),
      },
    });
  }

  listResults(id, query = {}, options = {}) {
    return this.request(`/api/v2/jobs/${encodeURIComponent(id)}/results${encodeQuery(query)}`, options);
  }
}
