import { normalizeLastHeardMs } from '@/renderer/lib/nodeStatus';
import type { NomadNodeRow } from '@/shared/nomad-types';

export const NOMAD_NODE_SORT_STORAGE_KEY = 'mesh-client:nomadNodeSort';

export type NomadNodeSortKey = 'lastSeen' | 'hops' | 'name';
export type NomadNodeSortDir = 'asc' | 'desc';

export interface NomadNodeSortPreference {
  key: NomadNodeSortKey;
  dir: NomadNodeSortDir;
}

export interface PreparedNomadNodeRow {
  node: NomadNodeRow;
  labelLower: string;
  hashLower: string;
  lastSeenMs: number | null;
  hops: number | null;
  favorited: boolean;
}

const SORT_KEYS: ReadonlySet<string> = new Set(['lastSeen', 'hops', 'name']);
const SORT_DIRS: ReadonlySet<string> = new Set(['asc', 'desc']);

export const DEFAULT_NOMAD_NODE_SORT: NomadNodeSortPreference = {
  key: 'lastSeen',
  dir: 'desc',
};

/** Default direction when switching to a column (Last Heard = newest first). */
export function defaultNomadNodeSortDir(key: NomadNodeSortKey): NomadNodeSortDir {
  return key === 'lastSeen' ? 'desc' : 'asc';
}

function isNomadNodeSortKey(value: unknown): value is NomadNodeSortKey {
  return typeof value === 'string' && SORT_KEYS.has(value);
}

function isNomadNodeSortDir(value: unknown): value is NomadNodeSortDir {
  return typeof value === 'string' && SORT_DIRS.has(value);
}

/** Parse persisted sort preference; invalid/missing → defaults. */
export function parseNomadNodeSortPreference(raw: string | null): NomadNodeSortPreference {
  if (!raw) return { ...DEFAULT_NOMAD_NODE_SORT };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object') return { ...DEFAULT_NOMAD_NODE_SORT };
    const record = parsed as Record<string, unknown>;
    const key = record.key;
    const dir = record.dir;
    if (!isNomadNodeSortKey(key) || !isNomadNodeSortDir(dir)) {
      return { ...DEFAULT_NOMAD_NODE_SORT };
    }
    return { key, dir };
  } catch {
    // catch-no-log-ok invalid localStorage JSON falls back to defaults
    return { ...DEFAULT_NOMAD_NODE_SORT };
  }
}

export function readNomadNodeSortPreference(): NomadNodeSortPreference {
  try {
    return parseNomadNodeSortPreference(localStorage.getItem(NOMAD_NODE_SORT_STORAGE_KEY));
  } catch {
    // catch-no-log-ok localStorage may throw in private mode
    return { ...DEFAULT_NOMAD_NODE_SORT };
  }
}

export function writeNomadNodeSortPreference(pref: NomadNodeSortPreference): void {
  try {
    localStorage.setItem(NOMAD_NODE_SORT_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // catch-no-log-ok localStorage may throw in private mode / quota
  }
}

function nomadNodeLabel(node: NomadNodeRow): string {
  const name = node.display_name?.trim();
  if (name) return name;
  return node.destination_hash.slice(0, 12);
}

function preparedLastSeenMs(lastSeen: number | null | undefined): number | null {
  if (lastSeen == null || !Number.isFinite(lastSeen) || lastSeen <= 0) return null;
  const ms = normalizeLastHeardMs(lastSeen);
  return ms > 0 ? ms : null;
}

function preparedHops(hops: number | null | undefined): number | null {
  if (hops == null || !Number.isFinite(hops)) return null;
  return hops;
}

/** One O(n) sort-key pass before sorting. */
export function prepareNomadNodeRows(rows: readonly NomadNodeRow[]): PreparedNomadNodeRow[] {
  return rows.map((node) => {
    const label = nomadNodeLabel(node);
    return {
      node,
      labelLower: label.toLowerCase(),
      hashLower: node.destination_hash.toLowerCase(),
      lastSeenMs: preparedLastSeenMs(node.last_seen),
      hops: preparedHops(node.hops),
      favorited: Boolean(node.favorited),
    };
  });
}

function compareNullableNumber(a: number | null, b: number | null, sign: number): number | null {
  if (a == null && b == null) return null;
  if (a == null) return 1;
  if (b == null) return -1;
  return sign * (a - b);
}

function comparePrepared(
  a: PreparedNomadNodeRow,
  b: PreparedNomadNodeRow,
  key: NomadNodeSortKey,
  dir: NomadNodeSortDir,
): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'name': {
      const byLabel = sign * a.labelLower.localeCompare(b.labelLower);
      if (byLabel !== 0) return byLabel;
      break;
    }
    case 'hops': {
      const byHops = compareNullableNumber(a.hops, b.hops, sign);
      if (byHops != null && byHops !== 0) return byHops;
      break;
    }
    case 'lastSeen': {
      const bySeen = compareNullableNumber(a.lastSeenMs, b.lastSeenMs, sign);
      if (bySeen != null && bySeen !== 0) return bySeen;
      break;
    }
    default:
      break;
  }
  return a.hashLower.localeCompare(b.hashLower);
}

/** Sort by the active column only (favorites tab already filters to favorites). */
export function sortPreparedNomadNodeRows(
  rows: readonly PreparedNomadNodeRow[],
  sortKey: NomadNodeSortKey,
  sortDir: NomadNodeSortDir,
): PreparedNomadNodeRow[] {
  const next = [...rows];
  next.sort((a, b) => comparePrepared(a, b, sortKey, sortDir));
  return next;
}
