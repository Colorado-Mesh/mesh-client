import { describe, expect, it, vi } from 'vitest';

import {
  MESHCORE_ERR_NOT_CONNECTED,
  serializeMeshcoreUserMessage,
} from './meshcore/meshcoreMessageI18n';
import {
  classifyRegionDiscoveryError,
  discoverMeshcoreRegions,
  isMeshcoreRegionDiscoveryStatusCurrent,
  mergeMeshcoreRegionTrees,
  MESHCORE_REGION_DISCOVERY_MAX_REPEATERS,
  type MeshcoreRegionDiscoveryCandidate,
  meshcoreRegionTreeFromAnonNames,
  scopeHashtagForRegionName,
  selectMeshcoreRegionDiscoveryCandidates,
  shouldPersistDiscoveredMeshcoreRegions,
} from './meshcoreRegionDiscovery';
import { parseMeshcoreRepeaterRegions } from './meshcoreRepeaterRegions';
import { MESHCORE_FLOOD_SCOPE_HASHTAG_MAX_LEN } from './meshcoreUtils';
import type { MeshNode } from './types';

function node(partial: Partial<MeshNode> & Pick<MeshNode, 'node_id' | 'hw_model'>): MeshNode {
  return {
    long_name: `Node-${partial.node_id}`,
    short_name: '',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    ...partial,
  };
}

function keyFor(nodeId: number): Uint8Array {
  const key = new Uint8Array(32);
  key[0] = nodeId & 0xff;
  key[1] = (nodeId >> 8) & 0xff;
  return key;
}

function candidate(
  partial: Partial<MeshcoreRegionDiscoveryCandidate> &
    Pick<MeshcoreRegionDiscoveryCandidate, 'nodeId'>,
): MeshcoreRegionDiscoveryCandidate {
  return {
    name: `Node-${partial.nodeId}`,
    publicKey: keyFor(partial.nodeId),
    ...partial,
  };
}

describe('scopeHashtagForRegionName', () => {
  it.each([
    ['us', '#us'],
    ['#us', '#us'],
    ['us-tn-tri', '#us-tn-tri'],
    ['US-TN', '#US-TN'],
  ] as const)('%s → %s', (input, expected) => {
    expect(scopeHashtagForRegionName(input)).toBe(expected);
  });

  it.each(['$private', '*', '', 'a\u0001b'] as const)('rejects %j', (input) => {
    expect(scopeHashtagForRegionName(input)).toBeNull();
  });

  it('rejects oversize hashtag forms', () => {
    const oversize = `#${'a'.repeat(MESHCORE_FLOOD_SCOPE_HASHTAG_MAX_LEN)}`;
    expect(oversize.length).toBeGreaterThan(MESHCORE_FLOOD_SCOPE_HASHTAG_MAX_LEN);
    expect(scopeHashtagForRegionName(oversize.slice(1))).toBeNull();
  });
});

describe('meshcoreRegionTreeFromAnonNames', () => {
  it('builds flat flood-allowed entries and strips # / *', () => {
    const tree = meshcoreRegionTreeFromAnonNames(['*', '#us', 'us', 'us-tn']);
    expect(tree.entries).toEqual([
      { name: 'us', depth: 0, home: false, floodAllowed: true },
      { name: 'us-tn', depth: 0, home: false, floodAllowed: true },
    ]);
    expect(tree.truncated).toBe(false);
  });
});

describe('mergeMeshcoreRegionTrees', () => {
  it('merges same name across repeaters with OR flags and min depth', () => {
    const a = parseMeshcoreRepeaterRegions('*\n us F\n  us-tn^\n');
    const b = parseMeshcoreRepeaterRegions('*\n us\n  us-tn F\n');
    const merged = mergeMeshcoreRegionTrees([
      { nodeId: 18, tree: a },
      { nodeId: 42, tree: b },
    ]);
    const usTn = merged.entries.find((e) => e.name === 'us-tn');
    expect(usTn).toMatchObject({
      scopeHashtag: '#us-tn',
      depth: 2,
      home: true,
      floodAllowed: true,
      sources: [18, 42],
    });
    const us = merged.entries.find((e) => e.name === 'us');
    expect(us?.floodAllowed).toBe(true);
    expect(us?.sources).toEqual([18, 42]);
  });

  it('dedupes the same name twice within one tree', () => {
    const tree = parseMeshcoreRepeaterRegions('*\n us F\n');
    const merged = mergeMeshcoreRegionTrees([
      { nodeId: 1, tree },
      { nodeId: 1, tree },
    ]);
    const us = merged.entries.find((e) => e.name === 'us');
    expect(us?.sources).toEqual([1]);
  });

  it('orders public then private then wildcard', () => {
    const tree = parseMeshcoreRepeaterRegions('*\n $zzz\n $aaa\n us\n aa\n');
    const { entries } = mergeMeshcoreRegionTrees([{ nodeId: 1, tree }]);
    expect(entries.map((e) => e.name)).toEqual(['aa', 'us', '$aaa', '$zzz', '*']);
  });

  it('preserves truncated source ids', () => {
    const complete = '* F\n' + ' region F\n'.repeat(15);
    const truncated = parseMeshcoreRepeaterRegions(complete + ' next');
    expect(truncated.truncated).toBe(true);
    const { truncatedSources } = mergeMeshcoreRegionTrees([{ nodeId: 42, tree: truncated }]);
    expect(truncatedSources).toEqual([42]);
  });
});

describe('selectMeshcoreRegionDiscoveryCandidates', () => {
  it('includes Repeaters and Rooms with pubkeys; skips missing keys and self', () => {
    const keys = new Map<number, Uint8Array>([
      [1, keyFor(1)],
      [2, keyFor(2)],
      [3, keyFor(3)],
    ]);
    const { candidates, skipped } = selectMeshcoreRegionDiscoveryCandidates(
      [
        node({ node_id: 1, hw_model: 'Repeater', long_name: 'A', last_heard: 100, hops_away: 1 }),
        node({ node_id: 2, hw_model: 'Room', long_name: 'Room', last_heard: 200, hops_away: 0 }),
        node({ node_id: 3, hw_model: 'Repeater', long_name: 'B', last_heard: 50, hops_away: 0 }),
        node({ node_id: 4, hw_model: 'Repeater', long_name: 'NoKey', last_heard: 300 }),
        node({ node_id: 99, hw_model: 'Repeater', long_name: 'Self', last_heard: 400 }),
        node({ node_id: 5, hw_model: 'Chat', long_name: 'Chat', last_heard: 500 }),
      ],
      {
        selfNodeId: 99,
        resolvePublicKey: (id) => keys.get(id) ?? null,
      },
    );
    expect(candidates.map((c) => c.nodeId)).toEqual([2, 3, 1]);
    expect(skipped).toEqual([{ nodeId: 4, reason: 'no-pubkey' }]);
    expect(candidates[0].publicKey).toEqual(keyFor(2));
  });

  it('falls back to public_key_hex on the node', () => {
    const hex = Array.from(keyFor(9), (b) => b.toString(16).padStart(2, '0')).join('');
    const { candidates, skipped } = selectMeshcoreRegionDiscoveryCandidates(
      [node({ node_id: 9, hw_model: 'Repeater', public_key_hex: hex })],
      {},
    );
    expect(skipped).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].publicKey).toEqual(keyFor(9));
  });

  it('orders by hops asc, lastHeard desc, then name and applies the cap', () => {
    const many = Array.from({ length: MESHCORE_REGION_DISCOVERY_MAX_REPEATERS + 5 }, (_, i) =>
      node({
        node_id: i + 1,
        hw_model: 'Repeater',
        long_name: `R${String(i + 1).padStart(2, '0')}`,
        last_heard: i,
        hops_away: i % 3,
      }),
    );
    const { candidates } = selectMeshcoreRegionDiscoveryCandidates(many, {
      resolvePublicKey: (id) => keyFor(id),
    });
    expect(candidates).toHaveLength(MESHCORE_REGION_DISCOVERY_MAX_REPEATERS);
    // All zero-hop candidates come before any multi-hop ones.
    const firstMultiHop = candidates.findIndex((c) => (c.hopsAway ?? 99) > 0);
    expect(firstMultiHop).toBeGreaterThan(0);
    expect(candidates.slice(0, firstMultiHop).every((c) => c.hopsAway === 0)).toBe(true);
    expect(candidates[0].lastHeard).toBeGreaterThanOrEqual(candidates[1].lastHeard ?? 0);
  });
});

describe('classifyRegionDiscoveryError', () => {
  it.each([
    ['infraConfig.regionsUnavailable', 'unsupported'],
    ['infraConfig.commandRejected', 'rejected'],
    ['infraConfig.invalidReply', 'invalid-reply'],
    ['infraConfig.sessionChanged', 'unreachable'],
  ] as const)('maps %s → %s', (key, reason) => {
    expect(classifyRegionDiscoveryError(new Error(serializeMeshcoreUserMessage({ key })))).toBe(
      reason,
    );
  });

  it('classifies timeout, flood, and unreachable strings', () => {
    expect(classifyRegionDiscoveryError(new Error('Request timed out'))).toBe('timeout');
    expect(classifyRegionDiscoveryError(new Error('Not connected'))).toBe('unreachable');
    expect(classifyRegionDiscoveryError(new Error(MESHCORE_ERR_NOT_CONNECTED))).toBe('unreachable');
    expect(classifyRegionDiscoveryError(new Error('contact not found'))).toBe('unreachable');
    expect(classifyRegionDiscoveryError(new Error('anon request sent as flood'))).toBe(
      'unreachable',
    );
    expect(classifyRegionDiscoveryError(new Error('boom'))).toBe('unknown');
  });
});

describe('isMeshcoreRegionDiscoveryStatusCurrent', () => {
  it.each(['connected', 'configured', 'stale'] as const)('allows %s', (status) => {
    expect(isMeshcoreRegionDiscoveryStatusCurrent(status)).toBe(true);
  });

  it.each(['disconnected', 'connecting', null, undefined] as const)('rejects %s', (status) => {
    expect(isMeshcoreRegionDiscoveryStatusCurrent(status)).toBe(false);
  });
});

describe('shouldPersistDiscoveredMeshcoreRegions', () => {
  it('skips cancelled and empty runs', () => {
    expect(shouldPersistDiscoveredMeshcoreRegions({ cancelled: true, entries: [{}, {}] })).toBe(
      false,
    );
    expect(shouldPersistDiscoveredMeshcoreRegions({ cancelled: false, entries: [] })).toBe(false);
    expect(shouldPersistDiscoveredMeshcoreRegions({ cancelled: false, entries: [{}] })).toBe(true);
  });
});

describe('discoverMeshcoreRegions with configured-status isCurrent', () => {
  it('still queries candidates when isCurrent mirrors configured/stale allowlist', async () => {
    const query = vi.fn(() => Promise.resolve(['us']));
    let status: 'configured' | 'disconnected' = 'configured';
    const run = await discoverMeshcoreRegions({
      candidates: [candidate({ nodeId: 1 })],
      query,
      isCurrent: () => isMeshcoreRegionDiscoveryStatusCurrent(status),
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(run.entries.map((e) => e.name)).toEqual(['us']);
    status = 'disconnected';
    expect(isMeshcoreRegionDiscoveryStatusCurrent(status)).toBe(false);
  });
});

describe('discoverMeshcoreRegions', () => {
  it('runs sequentially with max concurrency 1 via anon query', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const query = vi.fn(async (c: MeshcoreRegionDiscoveryCandidate) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return [`n${c.nodeId}`];
    });

    const run = await discoverMeshcoreRegions({
      candidates: [candidate({ nodeId: 1 }), candidate({ nodeId: 2 }), candidate({ nodeId: 3 })],
      query,
      isCurrent: () => true,
    });

    expect(maxInFlight).toBe(1);
    expect(query).toHaveBeenCalledTimes(3);
    expect(run.cancelled).toBe(false);
    expect(run.entries.map((e) => e.name).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(run.entries.every((e) => e.floodAllowed && e.depth === 0)).toBe(true);
    expect(run.failed).toEqual([]);
  });

  it('emits progress before each read and keeps partial results on failure', async () => {
    const progress: { done: number; total: number; nodeId: number }[] = [];
    const query = vi.fn((c: MeshcoreRegionDiscoveryCandidate) => {
      if (c.nodeId === 2) return Promise.reject(new Error('Request timed out'));
      return Promise.resolve([`ok${c.nodeId}`]);
    });

    const run = await discoverMeshcoreRegions({
      candidates: [candidate({ nodeId: 1 }), candidate({ nodeId: 2 }), candidate({ nodeId: 3 })],
      query,
      isCurrent: () => true,
      onProgress: (p) => {
        progress.push({ done: p.done, total: p.total, nodeId: p.nodeId });
      },
    });

    expect(progress.slice(0, 3)).toEqual([
      { done: 0, total: 3, nodeId: 1 },
      { done: 1, total: 3, nodeId: 2 },
      { done: 2, total: 3, nodeId: 3 },
    ]);
    expect(progress.at(-1)).toEqual({ done: 3, total: 3, nodeId: 3 });
    expect(run.failed).toEqual([{ nodeId: 2, reason: 'timeout' }]);
    expect(run.entries.some((e) => e.name === 'ok1')).toBe(true);
    expect(run.entries.some((e) => e.name === 'ok3')).toBe(true);
  });

  it('stops scheduling when aborted mid-loop and keeps committed results', async () => {
    const controller = new AbortController();
    const query = vi.fn((c: MeshcoreRegionDiscoveryCandidate) => {
      if (c.nodeId === 2) {
        controller.abort();
        return Promise.resolve(['b']);
      }
      return Promise.resolve(['a']);
    });

    const run = await discoverMeshcoreRegions({
      candidates: [candidate({ nodeId: 1 }), candidate({ nodeId: 2 }), candidate({ nodeId: 3 })],
      query,
      isCurrent: () => true,
      signal: controller.signal,
    });

    expect(run.cancelled).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(run.entries.some((e) => e.name === 'a')).toBe(true);
    expect(run.entries.some((e) => e.name === 'b')).toBe(false);
  });

  it('discards a completed reply when isCurrent becomes false', async () => {
    let current = true;
    const query = vi.fn(() => {
      current = false;
      return Promise.resolve(['late']);
    });

    const run = await discoverMeshcoreRegions({
      candidates: [candidate({ nodeId: 1 })],
      query,
      isCurrent: () => current,
    });

    expect(run.cancelled).toBe(true);
    expect(run.entries).toEqual([]);
  });

  it('queries each candidate once', async () => {
    const seen: number[] = [];
    const query = vi.fn((c: MeshcoreRegionDiscoveryCandidate) => {
      seen.push(c.nodeId);
      return Promise.resolve(['x']);
    });
    await discoverMeshcoreRegions({
      candidates: [candidate({ nodeId: 7 }), candidate({ nodeId: 8 })],
      query,
      isCurrent: () => true,
    });
    expect(seen).toEqual([7, 8]);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
