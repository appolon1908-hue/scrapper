const JSON_CONTENT_TYPE = 'application/json';

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
    query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
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

    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('A fetch implementation is required');
    }
  }

  withConnection(options = {}) {
    return new DashboardApiClient({
      baseUrl: options.baseUrl ?? this.baseUrl,
      tenantId: options.tenantId ?? this.tenantId,
      fetchImpl: this.fetchImpl,
      getAccessToken: options.getAccessToken ?? this.getAccessToken,
      credentials: this.credentials,
    });
  }

  async request(path, options = {}) {
    const method = options.method ?? 'GET';
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

    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        credentials: this.credentials,
        signal: options.signal,
      });
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : 'Network request failed', {
        code: 'network_error',
      });
    }

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes(JSON_CONTENT_TYPE);
    const payload = isJson
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => '');

    if (!response.ok) {
      const errorPayload = typeof payload === 'object' && payload ? payload : {};
      throw new ApiError(errorPayload.error || `Request failed with ${response.status}`, {
        status: response.status,
        code: errorPayload.error || 'request_failed',
        requestId: errorPayload.request_id || response.headers.get('x-request-id'),
        details: errorPayload.details || payload,
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

  capabilities(options) {
    return this.request('/api/v2/capabilities', options);
  }

  stats(options) {
    return this.request('/api/v2/stats', options);
  }

  listJobs(query = {}, options = {}) {
    return this.request(`/api/v2/jobs${encodeQuery(query)}`, options);
  }

  getJob(id, options = {}) {
    return this.request(`/api/v2/jobs/${encodeURIComponent(id)}`, options);
  }

  createJob(payload, command = {}, options = {}) {
    const correlationId = command.correlationId || newCommandId();
    const idempotencyKey = command.idempotencyKey || newCommandId();
    return this.request('/api/v2/jobs', {
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
    return this.request(`/api/v2/jobs/${encodeURIComponent(id)}/cancel`, {
      ...options,
      method: 'POST',
      headers: {
        ...options.headers,
        'x-correlation-id': command.correlationId || newCommandId(),
      },
    });
  }

  retryJob(id, command = {}, options = {}) {
    return this.request(`/api/v2/jobs/${encodeURIComponent(id)}/retry`, {
      ...options,
      method: 'POST',
      headers: {
        ...options.headers,
        'x-correlation-id': command.correlationId || newCommandId(),
      },
    });
  }

  listResults(id, query = {}, options = {}) {
    return this.request(
      `/api/v2/jobs/${encodeURIComponent(id)}/results${encodeQuery(query)}`,
      options,
    );
  }
}
