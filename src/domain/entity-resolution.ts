import crypto from 'node:crypto';
import { compareEin, fingerprintEin, maskEin } from './ein.js';
import type { BusinessRecord, CrawlJobRequest, Evidence, PublicOfficer } from './schemas.js';
import type { PageExtraction } from './extract.js';

function best<T extends { confidence: number }>(values: T[]): T | undefined {
  return [...values].sort((a, b) => b.confidence - a.confidence)[0];
}

function collectEvidence<T extends { value: string; evidence: Evidence }>(
  values: T[],
): Record<string, Evidence[]> {
  const result: Record<string, Evidence[]> = {};
  for (const value of values) {
    result[value.value] ??= [];
    result[value.value]?.push(value.evidence);
  }
  return result;
}

function mergeOfficers(values: PublicOfficer[]): PublicOfficer[] {
  const byKey = new Map<string, PublicOfficer>();
  for (const value of values) {
    const key = `${value.name}|${value.title}`.toLowerCase();
    const prior = byKey.get(key);
    if (!prior || value.confidence > prior.confidence) byKey.set(key, value);
    else prior.evidence.push(...value.evidence);
  }
  return [...byKey.values()].slice(0, 25);
}

function score(extractions: PageExtraction[]): number {
  const hasStructuredName = extractions.some((page) =>
    page.names.some((name) => name.confidence >= 0.9),
  );
  const hasEmail = extractions.some((page) => page.emails.length > 0);
  const hasPhone = extractions.some((page) => page.phones.length > 0);
  const hasAddress = extractions.some((page) => page.addresses.length > 0);
  const hasOfficer = extractions.some((page) => page.officers.length > 0);
  const value =
    0.25 +
    (hasStructuredName ? 0.25 : 0.1) +
    (hasEmail ? 0.12 : 0) +
    (hasPhone ? 0.12 : 0) +
    (hasAddress ? 0.1 : 0) +
    (hasOfficer ? 0.08 : 0) +
    Math.min(0.08, extractions.length * 0.01);
  return Math.min(0.99, Number(value.toFixed(3)));
}

export function resolveBusinessRecord(
  extractions: PageExtraction[],
  request: CrawlJobRequest,
  einPepper: string,
): BusinessRecord {
  if (!extractions.length) throw new Error('business_resolution_requires_pages');
  const allNames = extractions.flatMap((page) => page.names);
  const legalName = best(allNames.filter((name) => name.legal))?.value || null;
  const displayName = legalName || best(allNames)?.value || new URL(extractions[0]!.sourceUrl).hostname;
  const website = new URL(extractions[0]!.sourceUrl).origin;
  const domain = new URL(website).hostname.toLowerCase().replace(/^www\./, '');
  const emails = [...new Set(extractions.flatMap((page) => page.emails.map((value) => value.value)))];
  const phones = [...new Set(extractions.flatMap((page) => page.phones.map((value) => value.value)))];
  const addresses = [
    ...new Set(extractions.flatMap((page) => page.addresses.map((value) => value.value))),
  ];
  const socialProfiles = [
    ...new Set(extractions.flatMap((page) => page.socialProfiles.map((value) => value.value))),
  ];
  const descriptions = extractions.flatMap((page) => page.descriptions);
  const categories = [...new Set(extractions.flatMap((page) => page.categories))];
  const officers = mergeOfficers(extractions.flatMap((page) => page.officers));
  const observedEin = best(extractions.flatMap((page) => page.einCandidates))?.value || null;
  const comparison = compareEin(observedEin, request.verification?.knownEin);
  const einStatus = observedEin
    ? request.verification?.knownEin
      ? comparison
      : 'observed_public'
    : request.verification?.knownEin
      ? 'manual_review'
      : 'not_observed';
  const sensitiveEin = observedEin || request.verification?.knownEin || null;
  const now = new Date().toISOString();
  const entityKey = crypto
    .createHash('sha256')
    .update([domain, displayName.toLowerCase(), phones[0] || '', addresses[0] || ''].join('|'))
    .digest('hex');

  const evidence: Record<string, Evidence[]> = {};
  for (const [field, values] of [
    ['names', allNames],
    ['emails', extractions.flatMap((page) => page.emails)],
    ['phones', extractions.flatMap((page) => page.phones)],
    ['addresses', extractions.flatMap((page) => page.addresses)],
    ['socialProfiles', extractions.flatMap((page) => page.socialProfiles)],
  ] as const) {
    evidence[field] = Object.values(collectEvidence(values)).flat();
  }
  evidence.officers = officers.flatMap((officer) => officer.evidence);
  evidence.ein = extractions.flatMap((page) => page.einCandidates.map((value) => value.evidence));

  return {
    entityKey,
    legalName,
    displayName,
    website,
    domain,
    description: best(descriptions)?.value || null,
    emails: emails.slice(0, 50),
    phones: phones.slice(0, 50),
    addresses: addresses.slice(0, 20),
    socialProfiles: socialProfiles.slice(0, 30),
    categories: categories.slice(0, 30),
    officers,
    einMasked: sensitiveEin ? maskEin(sensitiveEin) : null,
    einFingerprint: sensitiveEin ? fingerprintEin(sensitiveEin, einPepper) : null,
    einStatus,
    confidence: score(extractions),
    evidence,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

export function mergeBusinessRecords(current: BusinessRecord, incoming: BusinessRecord): BusinessRecord {
  const merge = (a: string[], b: string[], max: number) => [...new Set([...a, ...b])].slice(0, max);
  const evidence: Record<string, Evidence[]> = { ...current.evidence };
  for (const [field, values] of Object.entries(incoming.evidence)) {
    evidence[field] = [...(evidence[field] || []), ...values];
  }
  return {
    ...current,
    legalName: current.legalName || incoming.legalName,
    displayName: incoming.confidence > current.confidence ? incoming.displayName : current.displayName,
    description: current.description || incoming.description,
    emails: merge(current.emails, incoming.emails, 50),
    phones: merge(current.phones, incoming.phones, 50),
    addresses: merge(current.addresses, incoming.addresses, 20),
    socialProfiles: merge(current.socialProfiles, incoming.socialProfiles, 30),
    categories: merge(current.categories, incoming.categories, 30),
    officers: mergeOfficers([...current.officers, ...incoming.officers]),
    einMasked: current.einMasked || incoming.einMasked,
    einFingerprint: current.einFingerprint || incoming.einFingerprint,
    einStatus:
      incoming.einStatus === 'verified' || current.einStatus === 'verified'
        ? 'verified'
        : incoming.einStatus,
    confidence: Math.max(current.confidence, incoming.confidence),
    evidence,
    lastSeenAt: incoming.lastSeenAt,
  };
}
