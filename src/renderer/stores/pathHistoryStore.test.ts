import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PathRecord } from '../lib/pathHistoryTypes';
import {
  computePathHash,
  computeScore,
  getWeightedPaths,
  usePathHistoryStore,
} from './pathHistoryStore';

// Silence fire-and-forget DB calls in all tests
beforeEach(() => {
  usePathHistoryStore.setState({ records: new Map(), lruOrder: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  usePathHistoryStore.setState({ records: new Map(), lruOrder: [] });
});

// ---------------------------------------------------------------------------
// computePathHash
// ---------------------------------------------------------------------------

describe('computePathHash', () => {
  it('encodes bytes as zero-padded hex', () => {
    expect(computePathHash([0, 1, 15, 255])).toBe('00010fff');
  });

  it('returns empty string for empty array', () => {
    expect(computePathHash([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// computeScore
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<PathRecord> = {}): PathRecord {
  return {
    nodeId: 1,
    pathHash: 'aabb',
    hopCount: 1,
    pathBytes: [0xaa, 0xbb],
    wasFloodDiscovery: false,
    successCount: 0,
    failureCount: 0,
    tripTimeMs: 0,
    routeWeight: 1.0,
    lastSuccessTs: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('computeScore', () => {
  it('uses Laplace-smoothed reliability with zero attempts', () => {
    const record = makeRecord({ successCount: 0, failureCount: 0 });
    const { reliability } = computeScore(record, 0, 1);
    // (0 + 1) / (0 + 2) = 0.5
    expect(reliability).toBeCloseTo(0.5);
  });

  it('reliability approaches 1 with many successes', () => {
    const record = makeRecord({ successCount: 98, failureCount: 2 });
    const { reliability } = computeScore(record, 0, 1);
    // (98 + 1) / (100 + 2) = 99/102
    expect(reliability).toBeCloseTo(99 / 102);
  });

  it('latency defaults to 0.6 when no trip time recorded', () => {
    const record = makeRecord({ tripTimeMs: 0 });
    const { latency } = computeScore(record, 0, 1);
    expect(latency).toBe(0.6);
  });

  it('latency is 1.0 for the fastest known path', () => {
    const record = makeRecord({ tripTimeMs: 100 });
    const { latency } = computeScore(record, 100, 1);
    expect(latency).toBe(1.0);
  });

  it('latency is 0.5 when trip time is twice the fastest', () => {
    const record = makeRecord({ tripTimeMs: 200 });
    const { latency } = computeScore(record, 100, 1);
    expect(latency).toBeCloseTo(0.5);
  });

  it('freshness is low for a stale record (no success ever)', () => {
    // ageInDays = 30 => freshness = 1 / 31
    const record = makeRecord({ lastSuccessTs: null });
    const { freshness } = computeScore(record, 0, 1);
    expect(freshness).toBeCloseTo(1 / 31);
  });

  it('freshness is high for a very recent success', () => {
    const record = makeRecord({ lastSuccessTs: Date.now() });
    const { freshness } = computeScore(record, 0, 1);
    // ageInDays ~ 0 => freshness ~ 1
    expect(freshness).toBeGreaterThan(0.99);
  });

  it('routeWeight is 1 when this is the highest known weight', () => {
    const record = makeRecord({ routeWeight: 5 });
    const { routeWeight } = computeScore(record, 0, 5);
    expect(routeWeight).toBe(1.0);
  });

  it('routeWeight defaults to 1 when highestKnownWeight is 0', () => {
    const record = makeRecord({ routeWeight: 0 });
    const { routeWeight } = computeScore(record, 0, 0);
    expect(routeWeight).toBe(1.0);
  });

  it('total is within [0, 1]', () => {
    const record = makeRecord({
      successCount: 10,
      failureCount: 1,
      tripTimeMs: 150,
      routeWeight: 3,
      lastSuccessTs: Date.now() - 3600_000,
    });
    const { total } = computeScore(record, 150, 5);
    expect(total).toBeGreaterThanOrEqual(0);
    expect(total).toBeLessThanOrEqual(1);
  });
});

describe('getWeightedPaths', () => {
  it('returns highest finite positive route weight per node', () => {
    const records = new Map<number, PathRecord[]>([
      [
        10,
        [
          makeRecord({ nodeId: 10, pathHash: 'a1', pathBytes: [1], routeWeight: 0.4 }),
          makeRecord({ nodeId: 10, pathHash: 'a2', pathBytes: [2], routeWeight: 1.4 }),
        ],
      ],
      [
        11,
        [
          makeRecord({ nodeId: 11, pathHash: 'b1', pathBytes: [3], routeWeight: Number.NaN }),
          makeRecord({ nodeId: 11, pathHash: 'b2', pathBytes: [4], routeWeight: 0 }),
          makeRecord({ nodeId: 11, pathHash: 'b3', pathBytes: [5], routeWeight: -1 }),
        ],
      ],
    ]);

    expect(getWeightedPaths(records)).toEqual([{ nodeId: 10, routeWeight: 1.4, pathBytes: [2] }]);
  });
});

// ---------------------------------------------------------------------------
// recordPathUpdated + LRU eviction
// ---------------------------------------------------------------------------

describe('recordPathUpdated', () => {
  it('adds a new path record for a node', () => {
    usePathHistoryStore.getState().recordPathUpdated(42, [0x01, 0x02], 1, false);
    const records = usePathHistoryStore.getState().records.get(42);
    expect(records).toHaveLength(1);
    expect(records![0].pathHash).toBe(computePathHash([0x01, 0x02]));
    expect(records![0].hopCount).toBe(1);
    expect(records![0].wasFloodDiscovery).toBe(false);
    expect(records![0].successCount).toBe(0);
  });

  it('deduplicates paths with the same hash', () => {
    usePathHistoryStore.getState().recordPathUpdated(42, [0x01], 1, false);
    usePathHistoryStore.getState().recordPathUpdated(42, [0x01], 2, true, 0.8);
    const records = usePathHistoryStore.getState().records.get(42);
    expect(records).toHaveLength(1);
    // Should update metadata but preserve outcome counts
    expect(records![0].hopCount).toBe(2);
    expect(records![0].wasFloodDiscovery).toBe(true);
    expect(records![0].routeWeight).toBeCloseTo(0.8);
    expect(records![0].successCount).toBe(0);
  });
});

describe('LRU eviction', () => {
  it('evicts the oldest contact when records exceed 50', () => {
    // Fill 50 contacts
    for (let i = 0; i < 50; i++) {
      usePathHistoryStore.getState().recordPathUpdated(i, [i], 1, false);
    }
    expect(usePathHistoryStore.getState().records.size).toBe(50);

    // Adding the 51st should evict the oldest (nodeId 0)
    usePathHistoryStore.getState().recordPathUpdated(100, [0xff], 1, false);
    expect(usePathHistoryStore.getState().records.size).toBe(50);
    expect(usePathHistoryStore.getState().records.has(0)).toBe(false);
    expect(usePathHistoryStore.getState().records.has(100)).toBe(true);
  });

  it('touching an existing contact moves it to MRU position', () => {
    for (let i = 0; i < 50; i++) {
      usePathHistoryStore.getState().recordPathUpdated(i, [i], 1, false);
    }
    // Re-touch nodeId 0 so it becomes MRU
    usePathHistoryStore.getState().recordPathUpdated(0, [0], 2, false);

    // Adding 51st should evict nodeId 1 (now oldest)
    usePathHistoryStore.getState().recordPathUpdated(100, [0xff], 1, false);
    expect(usePathHistoryStore.getState().records.has(0)).toBe(true);
    expect(usePathHistoryStore.getState().records.has(1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recordOutcome
// ---------------------------------------------------------------------------

describe('recordOutcome', () => {
  const NODE = 55;
  const PATH = [0xde, 0xad];
  const HASH = computePathHash(PATH);

  beforeEach(() => {
    usePathHistoryStore.getState().recordPathUpdated(NODE, PATH, 1, false);
  });

  it('increments successCount and records trip time on success', () => {
    usePathHistoryStore.getState().recordOutcome(NODE, HASH, true, 250);
    const rec = usePathHistoryStore.getState().records.get(NODE)![0];
    expect(rec.successCount).toBe(1);
    expect(rec.failureCount).toBe(0);
    expect(rec.tripTimeMs).toBe(250);
    expect(rec.lastSuccessTs).toBeGreaterThan(0);
  });

  it('only updates trip time when new time is faster', () => {
    usePathHistoryStore.getState().recordOutcome(NODE, HASH, true, 300);
    usePathHistoryStore.getState().recordOutcome(NODE, HASH, true, 500);
    const rec = usePathHistoryStore.getState().records.get(NODE)![0];
    expect(rec.tripTimeMs).toBe(300); // kept the faster time
    expect(rec.successCount).toBe(2);
  });

  it('increments failureCount on failure', () => {
    usePathHistoryStore.getState().recordOutcome(NODE, HASH, false);
    const rec = usePathHistoryStore.getState().records.get(NODE)![0];
    expect(rec.failureCount).toBe(1);
    expect(rec.successCount).toBe(0);
  });

  it('is a no-op for unknown nodeId', () => {
    expect(() => {
      usePathHistoryStore.getState().recordOutcome(999, HASH, true);
    }).not.toThrow();
  });

  it('is a no-op for unknown pathHash', () => {
    expect(() => {
      usePathHistoryStore.getState().recordOutcome(NODE, 'deadbeef', true);
    }).not.toThrow();
    const rec = usePathHistoryStore.getState().records.get(NODE)![0];
    expect(rec.successCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// selectBestPath
// ---------------------------------------------------------------------------

describe('selectBestPath', () => {
  it('returns null when no records exist', () => {
    expect(usePathHistoryStore.getState().selectBestPath(1)).toBeNull();
  });

  it('returns the single path when there is only one', () => {
    usePathHistoryStore.getState().recordPathUpdated(1, [0x01], 1, false);
    const sel = usePathHistoryStore.getState().selectBestPath(1);
    expect(sel).not.toBeNull();
    expect(sel!.pathHash).toBe(computePathHash([0x01]));
  });

  it('prefers higher-reliability path', () => {
    usePathHistoryStore.getState().recordPathUpdated(1, [0x01], 1, false);
    usePathHistoryStore.getState().recordPathUpdated(1, [0x02], 1, false);
    const hashA = computePathHash([0x01]);
    // Give path A 10 successes, path B 0
    for (let i = 0; i < 10; i++) {
      usePathHistoryStore.getState().recordOutcome(1, hashA, true, 100);
    }
    const sel = usePathHistoryStore.getState().selectBestPath(1);
    expect(sel!.pathHash).toBe(hashA);
  });

  it('prefers lower trip time when reliability is tied', () => {
    usePathHistoryStore.getState().recordPathUpdated(1, [0x01], 1, false);
    usePathHistoryStore.getState().recordPathUpdated(1, [0x02], 1, false);
    const hashFast = computePathHash([0x01]);
    const hashSlow = computePathHash([0x02]);
    for (let i = 0; i < 5; i++) {
      usePathHistoryStore.getState().recordOutcome(1, hashFast, true, 50);
    }
    for (let i = 0; i < 5; i++) {
      usePathHistoryStore.getState().recordOutcome(1, hashSlow, true, 200);
    }
    const sel = usePathHistoryStore.getState().selectBestPath(1);
    expect(sel!.pathHash).toBe(hashFast);
  });

  it('useFlood is true only for a flood path that has never succeeded', () => {
    usePathHistoryStore.getState().recordPathUpdated(1, [0x01], 1, true); // flood, no success
    const sel = usePathHistoryStore.getState().selectBestPath(1);
    expect(sel!.useFlood).toBe(true);

    // After one success, useFlood becomes false
    usePathHistoryStore.getState().recordOutcome(1, computePathHash([0x01]), true);
    const sel2 = usePathHistoryStore.getState().selectBestPath(1);
    expect(sel2!.useFlood).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clearForNode / clearAll
// ---------------------------------------------------------------------------

describe('clearForNode', () => {
  it('removes records and LRU entry for the node', () => {
    usePathHistoryStore.getState().recordPathUpdated(1, [0x01], 1, false);
    usePathHistoryStore.getState().recordPathUpdated(2, [0x02], 1, false);
    usePathHistoryStore.getState().clearForNode(1);
    expect(usePathHistoryStore.getState().records.has(1)).toBe(false);
    expect(usePathHistoryStore.getState().records.has(2)).toBe(true);
    expect(usePathHistoryStore.getState().lruOrder).not.toContain(1);
  });
});

describe('clearAll', () => {
  it('empties all records and LRU order', () => {
    usePathHistoryStore.getState().recordPathUpdated(1, [0x01], 1, false);
    usePathHistoryStore.getState().recordPathUpdated(2, [0x02], 1, false);
    usePathHistoryStore.getState().clearAll();
    expect(usePathHistoryStore.getState().records.size).toBe(0);
    expect(usePathHistoryStore.getState().lruOrder).toHaveLength(0);
  });
});

describe('loadAllFromDb', () => {
  it('hydrates path records from getAllMeshcorePathHistory', async () => {
    const row = {
      id: 1,
      node_id: 99,
      path_hash: 'ab',
      hop_count: 1,
      path_bytes: '[1,2]',
      was_flood_discovery: 0,
      success_count: 1,
      failure_count: 0,
      trip_time_ms: 100,
      route_weight: 1,
      last_success_ts: Date.now(),
      created_at: 1,
      updated_at: 2,
    };
    vi.spyOn(window.electronAPI.db, 'getAllMeshcorePathHistory').mockResolvedValue([row]);
    await usePathHistoryStore.getState().loadAllFromDb();
    const recs = usePathHistoryStore.getState().records.get(99);
    expect(recs?.length).toBe(1);
    expect(recs?.[0].pathBytes).toEqual([1, 2]);
    expect(recs?.[0].pathHash).toBe('ab');
  });
});
