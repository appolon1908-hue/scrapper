import { z } from 'zod';

const CsvContentSchema = z.string().max(50 * 1024 * 1024, 'csv_too_large');

const HEADER_ALIASES = new Map<string, string>([
  ['company', 'business_name'],
  ['company_name', 'business_name'],
  ['business', 'business_name'],
  ['business_name', 'business_name'],
  ['name', 'business_name'],
  ['url', 'website'],
  ['domain', 'website'],
  ['website', 'website'],
  ['email', 'known_email'],
  ['business_email', 'known_email'],
  ['known_email', 'known_email'],
  ['phone', 'known_phone'],
  ['telephone', 'known_phone'],
  ['known_phone', 'known_phone'],
  ['owner', 'known_owner'],
  ['owner_name', 'known_owner'],
  ['known_owner', 'known_owner'],
  ['country', 'country_code'],
  ['country_code', 'country_code'],
  ['external_id', 'external_reference'],
  ['external_reference', 'external_reference'],
  ['reference', 'external_reference'],
]);

export type CsvSeedRow = Record<string, unknown> & {
  _row: number;
  tags?: Record<string, string>;
};

export function cleanCsvHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function canonicalHeader(value: unknown): string {
  const normalized = cleanCsvHeader(value);
  return HEADER_ALIASES.get(normalized) ?? normalized;
}

function rowsFromCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      if (row.some((entry) => entry.trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (quoted) throw new Error('csv_unclosed_quote');
  row.push(value.replace(/\r$/, ''));
  if (row.some((entry) => entry.trim())) rows.push(row);
  return rows;
}

export function parseCsvSeedRows(content: unknown): CsvSeedRow[] {
  const text = CsvContentSchema.parse(content).replace(/^\uFEFF/, '');
  const rows = rowsFromCsv(text);
  if (rows.length === 0) return [];

  const headers = (rows[0] ?? []).map(canonicalHeader);
  if (!headers.includes('website')) throw new Error('import_website_column_required');
  const namedHeaders = headers.filter(Boolean);
  if (new Set(namedHeaders).size !== namedHeaders.length) {
    throw new Error('csv_duplicate_header');
  }

  return rows.slice(1).map((columns, rowIndex) => {
    const item: CsvSeedRow = { _row: rowIndex + 2 };
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      const cell = String(columns[columnIndex] ?? '').trim();
      if (header.startsWith('tag_')) {
        item.tags ??= {};
        item.tags[header.slice(4)] = cell;
      } else {
        item[header] = cell;
      }
    });
    return item;
  });
}

export const parseCsv = parseCsvSeedRows;
