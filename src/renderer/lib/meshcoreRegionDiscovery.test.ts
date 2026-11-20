import { describe, expect, it, vi } from 'vitest';

import { serializeMeshcoreUserMessage } from './meshcore/meshcoreMessageI18n';
import {
  classifyRegionDiscoveryError,
  discoverMeshcoreRegions,
  mergeMeshcoreRegionTrees,
  MESHCORE_REGION_DISCOVERY_MAX_REPEATERS,
  scopeHashtagForRegionName,
  selectMeshcoreRegionDiscoveryCandidates,
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
    // Parser rejects duplicate `*` roots; use a valid tree and merge twice from one source list
    // via two identical region entries by constructing manually through two sources with same node.
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
  const passwords = new Set([1, 2, 3]);

  it('includes only Repeaters with passwords, excludes self and Room', () => {
    const { candidates, skipped } = selectMeshcoreRegionDiscoveryCandidates(
      [
        node({ node_id: 1, hw_model: 'Repeater', long_name: 'A', last_heard: 100 }),
        node({ node_id: 2, hw_model: 'Room', long_name: 'Room', last_heard: 200 }),
        node({ node_id: 3, hw_model: 'Repeater', long_name: 'B', last_heard: 50 }),
        node({ node_id: 4, hw_model: 'Repeater', long_name: 'NoPass', last_heard: 300 }),
        node({ node_id: 99, hw_model: 'Repeater', long_name: 'Self', last_heard: 400 }),
        node({ node_id: 5, hw_model: 'Chat', long_name: 'Chat', last_heard: 500 }),
      ],
      {
        selfNodeId: 99,
        hasPassword: (id) => passwords.has(id),
      },
    );
    expect(candidates.map((c) => c.nodeId)).toEqual([1, 3]);
    expect(skipped).toEqual([{ nodeId: 4, reason: 'no-password' }]);
  });

  it('orders by lastHeard desc, hops asc, then name and applies the cap', () => {
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
      hasPassword: () => true,
    });
    expect(candidates).toHaveLength(MESHCORE_REGION_DISCOVERY_MAX_REPEATERS);
    expect(candidates[0].nodeId).toBe(MESHCORE_REGION_DISCOVERY_MAX_REPEATERS + 5);
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

  it('classifies timeout and unreachable strings', () => {
    expect(classifyRegionDiscoveryError(new Error('Request timed out'))).toBe('timeout');
    expect(classifyRegionDiscoveryError(new Error('Not connected'))).toBe('unreachable');
    expect(classifyRegionDiscoveryError(new Error('contact not found'))).toBe('unreachable');
    expect(classifyRegionDiscoveryError(new Error('boom'))).toBe('unknown');
  });
});

describe('discoverMeshcoreRegions', () => {
  it('runs sequentially with max concurrency 1 and sends only region', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const send = vi.fn(async (nodeId: number, command: string) => {
      expect(command).toBe('region');
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return `*\n n${nodeId} F\n`;
    });

    const run = await discoverMeshcoreRegions({
      candidates: [
        { nodeId: 1, name: 'One' },
        { nodeId: 2, name: 'Two' },
        { nodeId: 3, name: 'Three' },
      ],
      send,
      isCurrent: () => true,
    });

    expect(maxInFlight).toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
    expect(run.cancelled).toBe(false);
    expect(run.entries.map((e) => e.name).sort()).toEqual(['*', 'n1', 'n2', 'n3']);
    expect(run.failed).toEqual([]);
  });

  it('emits progress before each read and keeps partial results on failure', async () => {
    const progress: { done: number; total: number; nodeId: number }[] = [];
    const send = vi.fn((nodeId: number) => {
      if (nodeId === 2) return Promise.reject(new Error('Request timed out'));
      return Promise.resolve(`*\n ok${nodeId} F\n`);
    });

    const run = await discoverMeshcoreRegions({
      candidates: [
        { nodeId: 1, name: 'One' },
        { nodeId: 2, name: 'Two' },
        { nodeId: 3, name: 'Three' },
      ],
      send,
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
    const send = vi.fn((nodeId: number) => {
      if (nodeId === 2) {
        controller.abort();
        return Promise.resolve(`*\n b F\n`);
      }
      return Promise.resolve(`*\n a F\n`);
    });

    const run = await discoverMeshcoreRegions({
      candidates: [
        { nodeId: 1, name: 'One' },
        { nodeId: 2, name: 'Two' },
        { nodeId: 3, name: 'Three' },
      ],
      send,
      isCurrent: () => true,
      signal: controller.signal,
    });

    expect(run.cancelled).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(run.entries.some((e) => e.name === 'a')).toBe(true);
    expect(run.entries.some((e) => e.name === 'b')).toBe(false);
  });

  it('discards a completed reply when isCurrent becomes false', async () => {
    let current = true;
    const send = vi.fn(() => {
      current = false;
      return Promise.resolve(`*\n late F\n`);
    });

    const run = await discoverMeshcoreRegions({
      candidates: [{ nodeId: 1, name: 'One' }],
      send,
      isCurrent: () => current,
    });

    expect(run.cancelled).toBe(true);
    expect(run.entries).toEqual([]);
  });

  it('never sends more than one command per candidate', async () => {
    const commands: string[] = [];
    const send = vi.fn((nodeId: number, command: string, opts: { isCurrent?: () => boolean }) => {
      expect(nodeId).toBeGreaterThan(0);
      expect(opts).toBeDefined();
      commands.push(command);
      return Promise.resolve(`*\n x F\n`);
    });
    await discoverMeshcoreRegions({
      candidates: [
        { nodeId: 7, name: 'Seven' },
        { nodeId: 8, name: 'Eight' },
      ],
      send,
      isCurrent: () => true,
    });
    expect(commands).toEqual(['region', 'region']);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
