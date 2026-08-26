import crypto from 'node:crypto';

export function normalizeEin(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!/^\d{9}$/.test(digits)) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

export function maskEin(value: string): string | null {
  const normalized = normalizeEin(value);
  if (!normalized) return null;
  return `**-***${normalized.slice(-4)}`;
}

export function fingerprintEin(value: string, pepper: string): string | null {
  const normalized = normalizeEin(value);
  if (!normalized || !pepper) return null;
  return crypto.createHmac('sha256', pepper).update(normalized).digest('hex');
}

export function findPublicEinCandidates(text: string): string[] {
  const candidates: string[] = [];
  const pattern =
    /(?:EIN|Employer Identification Number|Federal Tax ID|Tax Identification Number)\s*(?:number|no\.?|#|:|-)?\s*(\d{2}-?\d{7})/gi;
  for (const match of text.matchAll(pattern)) {
    const normalized = normalizeEin(match[1] || '');
    if (normalized) candidates.push(normalized);
  }
  return [...new Set(candidates)];
}

export function compareEin(observed: string | null, known: string | undefined): 'verified' | 'mismatch' | 'manual_review' {
  if (!known) return 'manual_review';
  const observedNormalized = observed ? normalizeEin(observed) : null;
  const knownNormalized = normalizeEin(known);
  if (!observedNormalized || !knownNormalized) return 'manual_review';
  return observedNormalized === knownNormalized ? 'verified' : 'mismatch';
}
