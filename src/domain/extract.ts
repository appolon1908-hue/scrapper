import crypto from 'node:crypto';
import { load, type CheerioAPI } from 'cheerio';
import { findPublicEinCandidates } from './ein.js';
import type { Evidence, PublicOfficer } from './schemas.js';

export type PageExtraction = {
  sourceUrl: string;
  canonicalUrl: string;
  pageTitle: string;
  contentHash: string;
  textLength: number;
  names: Array<{ value: string; legal: boolean; confidence: number; evidence: Evidence }>;
  descriptions: Array<{ value: string; confidence: number; evidence: Evidence }>;
  emails: Array<{ value: string; confidence: number; evidence: Evidence }>;
  phones: Array<{ value: string; confidence: number; evidence: Evidence }>;
  addresses: Array<{ value: string; confidence: number; evidence: Evidence }>;
  socialProfiles: Array<{ value: string; confidence: number; evidence: Evidence }>;
  categories: string[];
  officers: PublicOfficer[];
  einCandidates: Array<{ value: string; confidence: number; evidence: Evidence }>;
  likelyContactPage: boolean;
  requiresBrowserFallback: boolean;
};

type JsonObject = Record<string, unknown>;

const BUSINESS_TYPES = new Set([
  'organization',
  'corporation',
  'localbusiness',
  'professionalservice',
  'store',
  'restaurant',
  'financialservice',
  'medicalbusiness',
  'legalservice',
  'homeandconstructionbusiness',
]);

const OFFICER_TITLES =
  /\b(owner|co-owner|founder|co-founder|chief executive officer|ceo|president|principal|managing member|managing partner|partner|director)\b/i;

const SOCIAL_HOSTS = new Set([
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'tiktok.com',
]);

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const candidate = key(value).toLowerCase();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(value);
  }
  return result;
}

function evidence(sourceUrl: string, extractor: string, label?: string): Evidence {
  return {
    sourceUrl,
    extractor,
    capturedAt: new Date().toISOString(),
    ...(label ? { label } : {}),
  };
}

function flattenJsonLd(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== 'object') return [];
  const object = value as JsonObject;
  const nested = object['@graph'];
  return [object, ...(nested ? flattenJsonLd(nested) : [])];
}

function parseJsonLd($: CheerioAPI): JsonObject[] {
  const values: JsonObject[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      values.push(...flattenJsonLd(JSON.parse($(element).text())));
    } catch {
      // Invalid third-party JSON-LD must not fail the crawl.
    }
  });
  return values;
}

function typeNames(object: JsonObject): string[] {
  const type = object['@type'];
  return (Array.isArray(type) ? type : [type])
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);
}

function businessObjects(values: JsonObject[]): JsonObject[] {
  return values.filter((object) => typeNames(object).some((type) => BUSINESS_TYPES.has(type)));
}

function normalizeEmail(value: string): string | null {
  const email = value
    .replace(/^mailto:/i, '')
    .split('?')[0]
    ?.trim()
    .toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return null;
  if (/\.(?:jpg|jpeg|png|gif|svg|webp)$/i.test(email)) return null;
  if (/@(?:example\.com|example\.org|example\.net|test\.com)$/i.test(email)) return null;
  return email;
}

function normalizePhone(value: string): string | null {
  const extension = value.match(/(?:ext\.?|x)\s*(\d{1,6})/i)?.[1];
  const startsPlus = value.trim().startsWith('+');
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `${startsPlus ? '+' : ''}${digits}${extension ? `x${extension}` : ''}`;
}

function jsonValue(object: JsonObject, key: string): string[] {
  const value = object[key];
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  if (value && typeof value === 'object') {
    const nested = value as JsonObject;
    return [clean(nested.name || nested.text || nested.value)].filter(Boolean);
  }
  return [clean(value)].filter(Boolean);
}

function addressFromObject(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return clean(value) || null;
  if (typeof value !== 'object') return null;
  const object = value as JsonObject;
  const result = [
    object.streetAddress,
    object.addressLocality,
    object.addressRegion,
    object.postalCode,
    object.addressCountry,
  ]
    .map(clean)
    .filter(Boolean)
    .join(', ');
  return result || null;
}

function extractOfficers(values: JsonObject[], sourceUrl: string, visibleText: string): PublicOfficer[] {
  const officers: PublicOfficer[] = [];
  const candidates: unknown[] = [];
  for (const object of values) {
    for (const key of ['founder', 'employee', 'member', 'director', 'creator']) {
      const value = object[key];
      if (Array.isArray(value)) candidates.push(...value);
      else if (value) candidates.push(value);
    }
    if (typeNames(object).includes('person')) candidates.push(object);
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const person = candidate as JsonObject;
    const name = clean(person.name);
    const title = clean(person.jobTitle || person.roleName);
    if (!name || !title || !OFFICER_TITLES.test(title)) continue;
    const email = normalizeEmail(clean(person.email));
    const phone = normalizePhone(clean(person.telephone));
    officers.push({
      name,
      title,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      confidence: 0.9,
      evidence: [evidence(sourceUrl, 'schema.org-person', title)],
    });
  }

  const textPattern = new RegExp(
    `(?:${OFFICER_TITLES.source.replace(/^\\b|\\b\/[a-z]*$/g, '')})\\s*(?:[:\\-|–—])\\s*([A-Z][A-Za-z'.-]+(?:\\s+[A-Z][A-Za-z'.-]+){1,4})`,
    'gi',
  );
  for (const match of visibleText.matchAll(textPattern)) {
    const title = clean(match[1]);
    const name = clean(match[2]);
    if (!name || !title) continue;
    officers.push({
      name,
      title,
      confidence: 0.58,
      evidence: [evidence(sourceUrl, 'visible-officer-label', title)],
    });
  }

  return unique(officers, (value) => `${value.name}|${value.title}`);
}

export function extractBusinessPage(html: string, sourceUrl: string): PageExtraction {
  const $ = load(html);
  $('script:not([type="application/ld+json"]),style,noscript,template,svg').remove();
  const visibleText = clean($('body').text()).slice(0, 2_000_000);
  const jsonLd = parseJsonLd($);
  const organizations = businessObjects(jsonLd);
  const pageTitle = clean($('title').first().text());
  const canonicalUrl = clean($('link[rel="canonical"]').attr('href')) || sourceUrl;
  const names: PageExtraction['names'] = [];
  const descriptions: PageExtraction['descriptions'] = [];
  const emails: PageExtraction['emails'] = [];
  const phones: PageExtraction['phones'] = [];
  const addresses: PageExtraction['addresses'] = [];
  const socialProfiles: PageExtraction['socialProfiles'] = [];
  const categories: string[] = [];

  for (const organization of organizations) {
    for (const value of jsonValue(organization, 'legalName')) {
      names.push({
        value,
        legal: true,
        confidence: 0.98,
        evidence: evidence(sourceUrl, 'schema.org-legalName'),
      });
    }
    for (const value of jsonValue(organization, 'name')) {
      names.push({
        value,
        legal: false,
        confidence: 0.95,
        evidence: evidence(sourceUrl, 'schema.org-name'),
      });
    }
    for (const value of jsonValue(organization, 'description')) {
      descriptions.push({
        value,
        confidence: 0.9,
        evidence: evidence(sourceUrl, 'schema.org-description'),
      });
    }
    for (const value of jsonValue(organization, 'email')) {
      const normalized = normalizeEmail(value);
      if (normalized)
        emails.push({
          value: normalized,
          confidence: 0.95,
          evidence: evidence(sourceUrl, 'schema.org-email'),
        });
    }
    for (const value of jsonValue(organization, 'telephone')) {
      const normalized = normalizePhone(value);
      if (normalized)
        phones.push({
          value: normalized,
          confidence: 0.95,
          evidence: evidence(sourceUrl, 'schema.org-telephone'),
        });
    }
    const address = addressFromObject(organization.address);
    if (address)
      addresses.push({
        value: address,
        confidence: 0.94,
        evidence: evidence(sourceUrl, 'schema.org-address'),
      });
    categories.push(...typeNames(organization), ...jsonValue(organization, 'keywords'));
  }

  const ogName = clean($('meta[property="og:site_name"]').attr('content'));
  if (ogName)
    names.push({
      value: ogName,
      legal: false,
      confidence: 0.82,
      evidence: evidence(sourceUrl, 'open-graph-site-name'),
    });
  const heading = clean($('h1').first().text());
  if (heading && heading.length <= 200)
    names.push({
      value: heading,
      legal: false,
      confidence: 0.68,
      evidence: evidence(sourceUrl, 'first-h1'),
    });
  if (pageTitle)
    names.push({
      value: pageTitle.split(/[|–—-]/)[0]?.trim() || pageTitle,
      legal: false,
      confidence: 0.55,
      evidence: evidence(sourceUrl, 'page-title'),
    });

  const metaDescription = clean($('meta[name="description"]').attr('content'));
  if (metaDescription)
    descriptions.push({
      value: metaDescription,
      confidence: 0.75,
      evidence: evidence(sourceUrl, 'meta-description'),
    });

  $('a[href^="mailto:"]').each((_, element) => {
    const normalized = normalizeEmail(String($(element).attr('href') || ''));
    if (normalized)
      emails.push({
        value: normalized,
        confidence: 0.92,
        evidence: evidence(sourceUrl, 'mailto-link'),
      });
  });
  for (const match of visibleText.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const normalized = normalizeEmail(match[0]);
    if (normalized)
      emails.push({
        value: normalized,
        confidence: 0.68,
        evidence: evidence(sourceUrl, 'visible-email'),
      });
  }

  $('a[href^="tel:"]').each((_, element) => {
    const normalized = normalizePhone(String($(element).attr('href') || '').replace(/^tel:/i, ''));
    if (normalized)
      phones.push({
        value: normalized,
        confidence: 0.92,
        evidence: evidence(sourceUrl, 'telephone-link'),
      });
  });
  for (const match of visibleText.matchAll(/(?:\+?\d[\d .()/-]{7,}\d)(?:\s*(?:ext\.?|x)\s*\d{1,6})?/gi)) {
    const normalized = normalizePhone(match[0]);
    if (normalized)
      phones.push({
        value: normalized,
        confidence: 0.58,
        evidence: evidence(sourceUrl, 'visible-phone'),
      });
  }

  $('address,[itemprop="address"]').each((_, element) => {
    const value = clean($(element).text());
    if (value.length >= 8)
      addresses.push({
        value,
        confidence: 0.72,
        evidence: evidence(sourceUrl, 'address-element'),
      });
  });

  $('a[href]').each((_, element) => {
    const href = String($(element).attr('href') || '');
    try {
      const url = new URL(href, sourceUrl);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (SOCIAL_HOSTS.has(host)) {
        socialProfiles.push({
          value: url.toString(),
          confidence: 0.8,
          evidence: evidence(sourceUrl, 'social-link'),
        });
      }
    } catch {
      // Ignore malformed links.
    }
  });

  const einCandidates = findPublicEinCandidates(visibleText).map((value) => ({
    value,
    confidence: 0.9,
    evidence: evidence(sourceUrl, 'public-ein-label'),
  }));
  const path = new URL(sourceUrl).pathname.toLowerCase();
  const likelyContactPage = /\b(contact|about|team|leadership|company|staff|management)\b/.test(path);
  const scriptCount = $('script[src]').length;
  const requiresBrowserFallback = visibleText.length < 250 && scriptCount >= 5;

  return {
    sourceUrl,
    canonicalUrl,
    pageTitle,
    contentHash: crypto.createHash('sha256').update(html).digest('hex'),
    textLength: visibleText.length,
    names: unique(names, (value) => value.value),
    descriptions: unique(descriptions, (value) => value.value),
    emails: unique(emails, (value) => value.value),
    phones: unique(phones, (value) => value.value),
    addresses: unique(addresses, (value) => value.value),
    socialProfiles: unique(socialProfiles, (value) => value.value),
    categories: [...new Set(categories.map(clean).filter(Boolean))].slice(0, 30),
    officers: extractOfficers(jsonLd, sourceUrl, visibleText),
    einCandidates,
    likelyContactPage,
    requiresBrowserFallback,
  };
}
