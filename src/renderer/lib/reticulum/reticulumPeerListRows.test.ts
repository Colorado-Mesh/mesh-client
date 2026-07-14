import { describe, expect, it, vi } from 'vitest';

import type { ReticulumPeer } from '@/shared/reticulum-types';

import {
  filterPreparedReticulumPeerRows,
  prepareReticulumPeerRows,
  sortPreparedReticulumPeerRows,
} from './reticulumPeerListRows';

function peer(partial: Partial<ReticulumPeer> & { destination_hash: string }): ReticulumPeer {
  return {
    display_name: null,
    hops: null,
    last_seen: 0,
    ...partial,
  };
}

describe('reticulumPeerListRows', () => {
  it('prepares label fields once per peer for filter and sort', () => {
    const labelFor = vi.fn((p: ReticulumPeer) => p.display_name ?? p.destination_hash);
    const peers = [
      peer({ destination_hash: 'bb00', display_name: 'Bob', hops: 2, last_seen: 10 }),
      peer({ destination_hash: 'aa00', display_name: 'Alice', hops: 1, last_seen: 20 }),
    ];
    const prepared = prepareReticulumPeerRows(peers, labelFor);
    expect(labelFor).toHaveBeenCalledTimes(2);

    const filtered = filterPreparedReticulumPeerRows(prepared, 'ali');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.label).toBe('Alice');
    expect(labelFor).toHaveBeenCalledTimes(2);

    const byName = sortPreparedReticulumPeerRows(prepared, 'name', 'asc');
    expect(byName.map((r) => r.label)).toEqual(['Alice', 'Bob']);
    expect(labelFor).toHaveBeenCalledTimes(2);
  });

  it('matches destination hash substrings case-insensitively', () => {
    const prepared = prepareReticulumPeerRows(
      [peer({ destination_hash: 'DeadBeefCafe', display_name: 'Hash Peer' })],
      (p) => p.display_name ?? p.destination_hash,
    );
    expect(filterPreparedReticulumPeerRows(prepared, 'beef')).toHaveLength(1);
    expect(filterPreparedReticulumPeerRows(prepared, 'nomatch')).toHaveLength(0);
  });

  it('keeps favorites ahead of name sort', () => {
    const prepared = prepareReticulumPeerRows(
      [
        peer({ destination_hash: 'a1', display_name: 'Alpha', favorited: false }),
        peer({ destination_hash: 'z9', display_name: 'Zulu', favorited: true }),
      ],
      (p) => p.display_name ?? p.destination_hash,
    );
    const sorted = sortPreparedReticulumPeerRows(prepared, 'name', 'asc');
    expect(sorted.map((r) => r.label)).toEqual(['Zulu', 'Alpha']);
  });

  it('finds overlay labels that differ from hash aliases', () => {
    const hash = 'aa'.repeat(16);
    const prepared = prepareReticulumPeerRows(
      [peer({ destination_hash: hash, display_name: hash.slice(0, 12) })],
      () => 'Nomad Overlay Name',
    );
    expect(filterPreparedReticulumPeerRows(prepared, 'overlay')).toHaveLength(1);
    expect(filterPreparedReticulumPeerRows(prepared, hash.slice(0, 8))).toHaveLength(1);
  });
});
