/**
 * Parse MeshCom contact import files (JSON / CSV).
 * Accepts Node List topology export (`nodes` array), raw contact arrays,
 * and SQLite-shaped `{ callsign, lat, lon, … }` rows.
 */

import { TOPOLOGY_EXPORT_FORMAT } from '../exportFormats';
import { lastHeardToUnixSeconds } from '../nodeStatus';
import { isMeshcomLegacyBroadcastPlaceholder, normalizeMeshcomCallsign } from './meshcomCallsign';

export interface MeshcomContactImportRow {
  callsign: string;
  lat?: number | null;
  lon?: number | null;
  favorited?: boolean;
  hw_id?: number | null;
  /** Last-heard epoch milliseconds (store / UI). */
  last_heard?: number | null;
}

export interface MeshcomContactImportParseResult {
  rows: MeshcomContactImportRow[];
  skipped: number;
  errors: string[];
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function parseCoord(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseFavorited(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'TRUE') return true;
  if (value === 0 || value === '0' || value === 'false' || value === 'FALSE') return false;
  return undefined;
}

function parseHwId(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Normalize last-heard to epoch ms for the node store. */
function parseLastHeardMs(rec: Record<string, unknown>, raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const unit = typeof rec.last_heard_unit === 'string' ? rec.last_heard_unit : '';
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'unix_sec') return Math.floor(n) * 1000;
  const sec = lastHeardToUnixSeconds(n);
  if (sec <= 0) return null;
  return sec < 1_000_000_000_000 ? sec * 1000 : Math.floor(n);
}

function protocolAllowsRow(rec: Record<string, unknown>): boolean {
  const protocol = firstString(rec.protocol);
  if (!protocol) return true;
  const p = protocol.toLowerCase();
  return p === 'meshcom' || p === 'mesh-com';
}

function rowFromRecord(rec: Record<string, unknown>): MeshcomContactImportRow | null {
  if (!protocolAllowsRow(rec)) return null;
  const callsign = normalizeMeshcomCallsign(
    firstString(
      rec.callsign,
      rec.call,
      rec.long_name,
      rec.longName,
      rec.longname, // CSV lowercases camelCase headers
      rec.name,
    ),
  );
  if (!callsign || isMeshcomLegacyBroadcastPlaceholder(callsign)) return null;
  const lat = parseCoord(rec.lat ?? rec.latitude);
  const lon = parseCoord(rec.lon ?? rec.longitude ?? rec.lng);
  const favorited = parseFavorited(rec.favorited ?? rec.favorite);
  const hw_id = parseHwId(rec.hw_id ?? rec.hwId ?? rec.hwid);
  const last_heard = parseLastHeardMs(rec, rec.last_heard ?? rec.lastHeard ?? rec.lastheard);
  return {
    callsign,
    lat,
    lon,
    ...(favorited !== undefined ? { favorited } : {}),
    hw_id,
    last_heard,
  };
}

function objectRecordArray(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object');
}

function extractJsonRows(parsed: unknown): Record<string, unknown>[] | null {
  const rootArray = objectRecordArray(parsed);
  if (rootArray != null) return rootArray;
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const nodes = objectRecordArray(obj.nodes);
  if (nodes != null) return nodes;
  const contacts = objectRecordArray(obj.contacts);
  if (contacts != null) return contacts;
  const arrays = Object.values(obj).filter(Array.isArray) as unknown[][];
  if (arrays.length === 1) {
    return objectRecordArray(arrays[0]);
  }
  if (obj.format === TOPOLOGY_EXPORT_FORMAT) {
    return objectRecordArray(obj.nodes);
  }
  return null;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  return cells;
}

/** Split CSV text into records, respecting quoted fields (CRLF / LF / CR separators). */
function splitCsvRecords(raw: string): string[] {
  const text = raw.replace(/^\uFEFF/, '');
  const records: string[] = [];
  let record = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inQuotes) {
      record += ch;
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          record += '"';
          i++;
        } else {
          inQuotes = false;
        }
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      record += ch;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      if (record.trim().length > 0) records.push(record);
      record = '';
      continue;
    }
    record += ch;
  }
  if (record.trim().length > 0) records.push(record);
  return records;
}

function parseCsvRecords(raw: string): Record<string, unknown>[] {
  const lines = splitCsvRecords(raw);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const rec: Record<string, unknown> = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      rec[key] = cells[c] ?? '';
    }
    rows.push(rec);
  }
  return rows;
}

function looksLikeCsv(raw: string): boolean {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  const firstLine = trimmed.split(/\r\n|\n/)[0] ?? '';
  return firstLine.includes(',');
}

/** Parse file text (JSON or CSV) into normalized MeshCom contact rows. */
export function parseMeshcomContactsImport(raw: string): MeshcomContactImportParseResult {
  const errors: string[] = [];
  const records: Record<string, unknown>[] = (() => {
    if (looksLikeCsv(raw)) {
      const csvRows = parseCsvRecords(raw);
      if (csvRows.length === 0) {
        errors.push('CSV has no data rows');
      }
      return csvRows;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (e: unknown) {
      // User-facing parse result; debug only so noisy invalid files stay out of the log stream.
      console.debug('[meshcomContactImport] JSON.parse failed', e);
      errors.push('Invalid JSON');
      return [];
    }
    const array = extractJsonRows(parsed);
    if (!array) {
      errors.push('JSON contains no array of contacts');
      return [];
    }
    return array;
  })();

  if (errors.includes('Invalid JSON') || errors.includes('JSON contains no array of contacts')) {
    return { rows: [], skipped: 0, errors };
  }

  const rows: MeshcomContactImportRow[] = [];
  let skipped = 0;
  for (const rec of records) {
    const row = rowFromRecord(rec);
    if (row) {
      rows.push(row);
    } else {
      skipped++;
    }
  }
  return { rows, skipped, errors };
}
