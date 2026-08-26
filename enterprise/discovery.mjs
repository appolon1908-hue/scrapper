import dns from 'node:dns/promises';
import net from 'node:net';
import { request } from 'undici';
import { config } from './config.mjs';
import { validateCompanies } from './csv-json.mjs';

function prohibitedAddress(address) {
  if (net.isIPv4(address)) {
    const octets = address.split('.').map(Number);
    return (
      octets[0] === 0 ||
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      octets[0] >= 224
    );
  }
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) return prohibitedAddress(value.slice(7));
  return (
    value === '::' ||
    value === '::1' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe8') ||
    value.startsWith('fe9') ||
    value.startsWith('fea') ||
    value.startsWith('feb')
  );
}

async function assertPublicProviderUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('search_provider_https_required');
  if (url.username || url.password) throw new Error('search_provider_credentials_in_url_forbidden');
  const answers = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some((answer) => prohibitedAddress(answer.address))) {
    throw new Error('search_provider_destination_rejected');
  }
  return url;
}

function buildQuery({ query, location, industry, countryCode }) {
  return [
    query,
    industry,
    location,
    countryCode,
    '-site:facebook.com',
    '-site:linkedin.com',
    '-site:yelp.com',
  ]
    .filter(Boolean)
    .join(' ');
}

function hostBlocked(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return config.searchBlockedHosts.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}

function officialCandidate(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (hostBlocked(url.hostname)) return null;
    url.username = '';
    url.password = '';
    url.hash = '';
    url.pathname = '/';
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function bingSearch(input) {
  const endpoint = config.searchEndpoint || 'https://api.bing.microsoft.com/v7.0/search';
  const url = await assertPublicProviderUrl(endpoint);
  url.searchParams.set('q', buildQuery(input));
  url.searchParams.set('count', String(Math.min(50, input.maxCompanies)));
  url.searchParams.set('responseFilter', 'Webpages');
  url.searchParams.set('safeSearch', 'Strict');
  url.searchParams.set('textDecorations', 'false');
  const response = await request(url, {
    method: 'GET',
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Ocp-Apim-Subscription-Key': config.searchApiKey,
      accept: 'application/json',
      'user-agent': 'CodestraBusinessDiscovery/1.0',
    },
  });
  const body = await response.body.json();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`bing_search_${response.statusCode}`);
  }
  return {
    providerRequestId: response.headers['x-msedge-clientid'] || null,
    results: (body?.webPages?.value || []).map((item) => ({
      title: item.name,
      url: item.url,
      snippet: item.snippet,
    })),
  };
}

async function googleSearch(input) {
  if (!config.googleSearchEngineId) throw new Error('google_search_engine_id_required');
  const endpoint = config.searchEndpoint || 'https://www.googleapis.com/customsearch/v1';
  const url = await assertPublicProviderUrl(endpoint);
  url.searchParams.set('key', config.searchApiKey);
  url.searchParams.set('cx', config.googleSearchEngineId);
  url.searchParams.set('q', buildQuery(input));
  url.searchParams.set('num', String(Math.min(10, input.maxCompanies)));
  url.searchParams.set('safe', 'active');
  const response = await request(url, {
    method: 'GET',
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
    signal: AbortSignal.timeout(30_000),
    headers: { accept: 'application/json', 'user-agent': 'CodestraBusinessDiscovery/1.0' },
  });
  const body = await response.body.json();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`google_search_${response.statusCode}`);
  }
  return {
    providerRequestId: body?.queries?.request?.[0]?.startIndex
      ? String(body.queries.request[0].startIndex)
      : null,
    results: (body?.items || []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    })),
  };
}

async function customSearch(input) {
  if (!config.searchEndpoint) throw new Error('custom_search_endpoint_required');
  const url = await assertPublicProviderUrl(config.searchEndpoint);
  const response = await request(url, {
    method: 'POST',
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Bearer ${config.searchApiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'CodestraBusinessDiscovery/1.0',
    },
    body: JSON.stringify({
      query: buildQuery(input),
      country_code: input.countryCode,
      max_results: input.maxCompanies,
    }),
  });
  const body = await response.body.json();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`custom_search_${response.statusCode}`);
  }
  const items = Array.isArray(body?.results)
    ? body.results
    : Array.isArray(body?.items)
      ? body.items
      : [];
  return {
    providerRequestId: body?.request_id || body?.id || null,
    results: items.map((item) => ({
      title: item.title || item.name,
      url: item.url || item.link || item.website,
      snippet: item.snippet || item.description,
    })),
  };
}

export async function discoverBusinesses(input) {
  if (!config.discoveryEnabled) throw new Error('search_discovery_disabled');
  if (!config.searchApiKey) throw new Error('search_api_key_missing');
  const provider = String(input.provider || config.searchProvider).toLowerCase();
  const country = String(input.countryCode || 'US').toLowerCase();
  if (!config.searchAllowedCountries.includes(country))
    throw new Error('search_country_not_allowed');

  const response =
    provider === 'bing'
      ? await bingSearch(input)
      : provider === 'google_cse'
        ? await googleSearch(input)
        : provider === 'custom'
          ? await customSearch(input)
          : (() => {
              throw new Error('unsupported_search_provider');
            })();

  const companies = [];
  const seen = new Set();
  for (const result of response.results) {
    const website = officialCandidate(result.url);
    if (!website) continue;
    const domain = new URL(website).hostname.toLowerCase().replace(/^www\./, '');
    if (seen.has(domain)) continue;
    seen.add(domain);
    companies.push({
      business_name: String(result.title || '')
        .replace(/\s+[|–—-].*$/, '')
        .slice(0, 300),
      website,
      country_code: String(input.countryCode || 'US').toUpperCase(),
      external_reference: `search:${provider}:${domain}`,
      tags: {
        discovery_provider: provider,
        discovery_query: input.query,
        discovery_snippet: String(result.snippet || '').slice(0, 500),
      },
    });
    if (companies.length >= input.maxCompanies) break;
  }

  const validated = validateCompanies(companies, { maxCompanies: input.maxCompanies });
  return {
    ...validated,
    provider,
    providerRequestId: response.providerRequestId,
    rawResultCount: response.results.length,
  };
}
