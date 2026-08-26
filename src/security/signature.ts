import crypto from 'node:crypto';

export type SignatureInput = {
  method: string;
  path: string;
  timestamp: string;
  eventId: string;
  source: string;
  tenantId: string;
  idempotencyKey: string;
  scopes: string[];
  body: string;
};

function normalizePath(path: string): string {
  const url = new URL(path, 'https://signature.invalid');
  const normalizedPath = `/${url.pathname.split('/').filter(Boolean).join('/')}`;
  const query = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    `${aKey}=${aValue}`.localeCompare(`${bKey}=${bValue}`),
  );
  const suffix = query.length ? `?${new URLSearchParams(query).toString()}` : '';
  return `${normalizedPath}${suffix}`;
}

export function canonicalSignatureInput(input: SignatureInput): string {
  const bodyHash = crypto.createHash('sha256').update(input.body).digest('hex');
  return [
    'v2',
    input.method.toUpperCase(),
    normalizePath(input.path),
    input.timestamp,
    input.eventId,
    input.source,
    input.tenantId,
    [...input.scopes].sort().join(' '),
    input.idempotencyKey,
    bodyHash,
  ].join('\n');
}

export function signRequest(secret: string, input: SignatureInput): string {
  if (!secret) throw new Error('outbound_hmac_secret_missing');
  return `sha256=${crypto
    .createHmac('sha256', secret)
    .update(canonicalSignatureInput(input))
    .digest('hex')}`;
}

export function verifySignature(secret: string, expected: string, input: SignatureInput): boolean {
  if (!secret || !expected.startsWith('sha256=')) return false;
  const actual = signRequest(secret, input);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
