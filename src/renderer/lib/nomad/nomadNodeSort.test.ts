import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NomadNodeRow } from '@/shared/nomad-types';

import {
  DEFAULT_NOMAD_NODE_SORT,
  defaultNomadNodeSortDir,
  NOMAD_NODE_SORT_STORAGE_KEY,
  parseNomadNodeSortPreference,
  prepareNomadNodeRows,
  readNomadNodeSortPreference,
  sortPreparedNomadNodeRows,
  writeNomadNodeSortPreference,
} from './nomadNodeSort';

function node(partial: Partial<NomadNodeRow> & { destination_hash: string }): NomadNodeRow {
  return {
    display_name: null,
    last_seen: null,
    hops: null,
    favorited: false,
    ...partial,
  };
}

describe('nomadNodeSort', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    });
  });

  it('defaultNomadNodeSortDir is desc for lastSeen and asc otherwise', () => {
    expect(defaultNomadNodeSortDir('lastSeen')).toBe('desc');
    expect(defaultNomadNodeSortDir('hops')).toBe('asc');
    expect(defaultNomadNodeSortDir('name')).toBe('asc');
  });

  it('returns empty for empty input', () => {
    expect(prepareNomadNodeRows([])).toEqual([]);
    expect(sortPreparedNomadNodeRows([], 'lastSeen', 'desc')).toEqual([]);
  });

  it('keeps favorites ahead of any column sort', () => {
    const prepared = prepareNomadNodeRows([
      node({ destination_hash: 'a1', display_name: 'Alpha', favorited: false, last_seen: 200 }),
      node({ destination_hash: 'z9', display_name: 'Zulu', favorited: true, last_seen: 100 }),
    ]);
    const sorted = sortPreparedNomadNodeRows(prepared, 'lastSeen', 'desc');
    expect(sorted.map((r) => r.node.display_name)).toEqual(['Zulu', 'Alpha']);
  });

  it('sorts lastSeen newest first (desc) and oldest first (asc)', () => {
    const prepared = prepareNomadNodeRows([
      node({ destination_hash: 'old', display_name: 'Old', last_seen: 100 }),
      node({ destination_hash: 'new', display_name: 'New', last_seen: 300 }),
      node({ destination_hash: 'mid', display_name: 'Mid', last_seen: 200 }),
    ]);
    expect(
      sortPreparedNomadNodeRows(prepared, 'lastSeen', 'desc').map((r) => r.node.display_name),
    ).toEqual(['New', 'Mid', 'Old']);
    expect(
      sortPreparedNomadNodeRows(prepared, 'lastSeen', 'asc').map((r) => r.node.display_name),
    ).toEqual(['Old', 'Mid', 'New']);
  });

  it('puts null and missing last_seen at the end for both directions', () => {
    const prepared = prepareNomadNodeRows([
      node({ destination_hash: 'seen', display_name: 'Seen', last_seen: 100 }),
      node({ destination_hash: 'null', display_name: 'NullSeen', last_seen: null }),
      node({ destination_hash: 'undef', display_name: 'UndefSeen' }),
      node({ destination_hash: 'zero', display_name: 'ZeroSeen', last_seen: 0 }),
    ]);
    expect(
      sortPreparedNomadNodeRows(prepared, 'lastSeen', 'desc').map((r) => r.node.display_name),
    ).toEqual(['Seen', 'NullSeen', 'UndefSeen', 'ZeroSeen']);
    expect(
      sortPreparedNomadNodeRows(prepared, 'lastSeen', 'asc').map((r) => r.node.display_name),
    ).toEqual(['Seen', 'NullSeen', 'UndefSeen', 'ZeroSeen']);
  });

  it('sorts hops closest first (asc) and farthest first (desc)', () => {
    const prepared = prepareNomadNodeRows([
      node({ destination_hash: 'far', display_name: 'Far', hops: 5 }),
      node({ destination_hash: 'near', display_name: 'Near', hops: 1 }),
      node({ destination_hash: 'mid', display_name: 'Mid', hops: 3 }),
    ]);
    expect(
      sortPreparedNomadNodeRows(prepared, 'hops', 'asc').map((r) => r.node.display_name),
    ).toEqual(['Near', 'Mid', 'Far']);
    expect(
      sortPreparedNomadNodeRows(prepared, 'hops', 'desc').map((r) => r.node.display_name),
    ).toEqual(['Far', 'Mid', 'Near']);
  });

  it('puts null hops at the end for both directions', () => {
    const prepared = prepareNomadNodeRows([
      node({ destination_hash: 'known', display_name: 'Known', hops: 2 }),
      node({ destination_hash: 'null', display_name: 'NullHops', hops: null }),
      node({ destination_hash: 'undef', display_name: 'UndefHops' }),
    ]);
    expect(
      sortPreparedNomadNodeRows(prepared, 'hops', 'asc').map((r) => r.node.display_name),
    ).toEqual(['Known', 'NullHops', 'UndefHops']);
    expect(
      sortPreparedNomadNodeRows(prepared, 'hops', 'desc').map((r) => r.node.display_name),
    ).toEqual(['Known', 'NullHops', 'UndefHops']);
  });

  it('sorts name A–Z / Z–A and falls back to hash when name is missing', () => {
    const prepared = prepareNomadNodeRows([
      node({ destination_hash: 'bb00hash', display_name: 'Bob' }),
      node({ destination_hash: 'aa00hash', display_name: null }),
      node({ destination_hash: 'cc00hash', display_name: 'Alice' }),
    ]);
    expect(sortPreparedNomadNodeRows(prepared, 'name', 'asc').map((r) => r.labelLower)).toEqual([
      'aa00hash',
      'alice',
      'bob',
    ]);
    expect(sortPreparedNomadNodeRows(prepared, 'name', 'desc').map((r) => r.labelLower)).toEqual([
      'bob',
      'alice',
      'aa00hash',
    ]);
  });

  it('parseNomadNodeSortPreference validates JSON and falls back to defaults', () => {
    expect(parseNomadNodeSortPreference(null)).toEqual(DEFAULT_NOMAD_NODE_SORT);
    expect(parseNomadNodeSortPreference('not-json')).toEqual(DEFAULT_NOMAD_NODE_SORT);
    expect(parseNomadNodeSortPreference('{}')).toEqual(DEFAULT_NOMAD_NODE_SORT);
    expect(parseNomadNodeSortPreference('{"key":"favorite","dir":"asc"}')).toEqual(
      DEFAULT_NOMAD_NODE_SORT,
    );
    expect(parseNomadNodeSortPreference('{"key":"hops","dir":"asc"}')).toEqual({
      key: 'hops',
      dir: 'asc',
    });
  });

  it('read/writeNomadNodeSortPreference round-trips through localStorage', () => {
    writeNomadNodeSortPreference({ key: 'name', dir: 'desc' });
    expect(readNomadNodeSortPreference()).toEqual({ key: 'name', dir: 'desc' });
    expect(localStorage.getItem(NOMAD_NODE_SORT_STORAGE_KEY)).toBe(
      JSON.stringify({ key: 'name', dir: 'desc' }),
    );
  });
});
