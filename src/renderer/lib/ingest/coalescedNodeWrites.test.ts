/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type NodeRecord, upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import { getIdentityNode } from '../identityStoreReads';
import type { MeshNode } from '../types';
import {
  enqueueNodeWrite,
  flushNodeWrites,
  MAX_PENDING_NODE_WRITES,
  NODE_WRITE_COALESCE_MS,
  NODE_WRITE_FLUSH_MAX_PENDING,
  peekPendingNodeRecord,
  resetCoalescedNodeWritesForTests,
} from './coalescedNodeWrites';

const ID_A = 'id-mesh-a';
const ID_B = 'id-mesh-b';

function record(nodeId: number, patch: Partial<NodeRecord> = {}): NodeRecord {
  return { nodeId, longName: `N${nodeId}`, snr: 1, ...patch };
}

describe('coalescedNodeWrites', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCoalescedNodeWritesForTests();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    window.electronAPI = {
      db: {
        saveNodes: vi
          .fn()
          .mockImplementation((nodes: unknown[]) =>
            Promise.resolve({ saved: nodes.length, dropped: 0 }),
          ),
        saveNode: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    resetCoalescedNodeWritesForTests();
    vi.useRealTimers();
  });

  it('collapses 5 enqueues for one node into 1 store notification and 1 saveNodes call', async () => {
    let notifications = 0;
    const unsub = useNodeStore.subscribe(() => {
      notifications += 1;
    });
    for (let i = 0; i < 5; i++) {
      enqueueNodeWrite(ID_A, record(7, { snr: i }));
    }
    expect(notifications).toBe(0);
    expect(peekPendingNodeRecord(ID_A, 7)?.snr).toBe(4);
    await vi.advanceTimersByTimeAsync(NODE_WRITE_COALESCE_MS);
    await flushNodeWrites();
    unsub();
    expect(notifications).toBe(1);
    expect(window.electronAPI.db.saveNodes).toHaveBeenCalledTimes(1);
    expect(getIdentityNode(ID_A, 7)?.snr).toBe(4);
  });

  it('batches 3 distinct nodes into one saveNodes invoke', async () => {
    enqueueNodeWrite(ID_A, record(1));
    enqueueNodeWrite(ID_A, record(2));
    enqueueNodeWrite(ID_A, record(3));
    await vi.advanceTimersByTimeAsync(NODE_WRITE_COALESCE_MS);
    await flushNodeWrites();
    expect(window.electronAPI.db.saveNodes).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(window.electronAPI.db.saveNodes).mock.calls[0][0];
    expect(arg).toHaveLength(3);
  });

  it('flushes when pending reaches NODE_WRITE_FLUSH_MAX_PENDING', async () => {
    for (let i = 0; i < NODE_WRITE_FLUSH_MAX_PENDING; i++) {
      enqueueNodeWrite(ID_A, record(i + 1));
    }
    await flushNodeWrites();
    expect(window.electronAPI.db.saveNodes).toHaveBeenCalled();
    expect(peekPendingNodeRecord(ID_A, 1)).toBeUndefined();
  });

  it('keeps pending bounded during a sync burst via mid-burst flushes', async () => {
    // Mid-burst flushes at 500 empty the pending map; the hard cap (8000) is a
    // safety valve for pathological async overlap rather than the steady burst path.
    for (let i = 0; i < NODE_WRITE_FLUSH_MAX_PENDING * 3; i++) {
      enqueueNodeWrite(ID_A, record(i + 1));
    }
    await flushNodeWrites();
    expect(Object.keys(useNodeStore.getState().nodes[ID_A] ?? {}).length).toBe(
      NODE_WRITE_FLUSH_MAX_PENDING * 3,
    );
    expect(vi.mocked(window.electronAPI.db.saveNodes).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(MAX_PENDING_NODE_WRITES).toBeGreaterThan(NODE_WRITE_FLUSH_MAX_PENDING);
  });

  it('flushNodeWrites is idempotent when empty', async () => {
    await flushNodeWrites();
    await flushNodeWrites();
    expect(window.electronAPI.db.saveNodes).not.toHaveBeenCalled();
  });

  it('read-through preserves both updates for the same node in one window', async () => {
    enqueueNodeWrite(ID_A, record(9, { snr: 1, hopsAway: 3, lastHeardAt: 100 }));
    const mid = getIdentityNode(ID_A, 9);
    expect(mid?.snr).toBe(1);
    expect(mid?.hops_away).toBe(3);
    enqueueNodeWrite(
      ID_A,
      record(9, {
        snr: mid!.snr,
        hopsAway: mid!.hops_away,
        lastHeardAt: 200,
        rssi: -80,
      }),
    );
    await flushNodeWrites();
    const final = getIdentityNode(ID_A, 9);
    expect(final?.snr).toBe(1);
    expect(final?.hops_away).toBe(3);
    expect(final?.rssi).toBe(-80);
    expect(final?.last_heard).toBe(200);
  });

  it('serializes dual-protocol flushes per identity', async () => {
    const order: string[] = [];
    window.electronAPI.db.saveNodes = vi.fn().mockImplementation((nodes: { node_id: number }[]) => {
      order.push(nodes[0].node_id === 1 ? 'a' : 'b');
      return Promise.resolve({ saved: nodes.length, dropped: 0 });
    });
    enqueueNodeWrite(ID_A, record(1));
    enqueueNodeWrite(ID_B, record(2));
    await flushNodeWrites();
    expect(order).toEqual(['a', 'b']);
  });

  it('keeps drained records readable until flushSnapshot applies them', async () => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    window.electronAPI.db.saveNodes = vi.fn().mockImplementation(async () => {
      await saveGate;
      return { saved: 1, dropped: 0 };
    });
    enqueueNodeWrite(ID_A, record(55, { snr: 7, longName: 'Draining' }));
    const flushPromise = flushNodeWrites();
    // Pending was swapped out, but read-through must still see the in-flight record.
    expect(peekPendingNodeRecord(ID_A, 55)?.snr).toBe(7);
    expect(getIdentityNode(ID_A, 55)?.snr).toBe(7);
    // Newer enqueue while flush is blocked must win over the drained snapshot.
    enqueueNodeWrite(ID_A, record(55, { snr: 8, longName: 'Newer' }));
    expect(peekPendingNodeRecord(ID_A, 55)?.snr).toBe(8);
    releaseSave();
    await flushPromise;
    await flushNodeWrites();
    expect(getIdentityNode(ID_A, 55)?.snr).toBe(8);
    expect(peekPendingNodeRecord(ID_A, 55)).toBeUndefined();
  });

  it('applies in-memory state even when saveNodes fails (retry queue)', async () => {
    window.electronAPI.db.saveNodes = vi.fn().mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enqueueNodeWrite(ID_A, record(44, { snr: 9 }));
    await flushNodeWrites();
    expect(getIdentityNode(ID_A, 44)?.snr).toBe(9);
    warn.mockRestore();
  });

  it('queues persistDbWrite when saveNodes reports dropped rows', async () => {
    const retrySpy = vi.spyOn(await import('../dbPersistRetry'), 'persistDbWrite');
    window.electronAPI.db.saveNodes = vi
      .fn()
      .mockResolvedValueOnce({ saved: 0, dropped: 1 })
      .mockResolvedValue({ saved: 1, dropped: 0 });
    enqueueNodeWrite(ID_A, record(90, { snr: 3 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await flushNodeWrites();
    expect(warn).toHaveBeenCalled();
    expect(retrySpy).toHaveBeenCalled();
    warn.mockRestore();
    retrySpy.mockRestore();
  });

  it('keeps newer direct upsert lastHeardAt when flushing an older pending coalesced snapshot', async () => {
    enqueueNodeWrite(ID_A, record(12, { lastHeardAt: 100 }));
    upsertNodeRecord(ID_A, { nodeId: 12, lastHeardAt: 500 });
    await flushNodeWrites();
    expect(getIdentityNode(ID_A, 12)?.last_heard).toBe(500);
  });

  it('reconciles onFlush callbacks with the same lastHeardAt as saveNodes', async () => {
    const flushed: MeshNode[] = [];
    enqueueNodeWrite(ID_A, record(77, { lastHeardAt: 100, snr: 2 }), {
      onFlushNode: (node) => {
        flushed.push(node);
      },
    });
    upsertNodeRecord(ID_A, { nodeId: 77, lastHeardAt: 900 });
    await flushNodeWrites();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.last_heard).toBe(900);
    const saveArg = vi.mocked(window.electronAPI.db.saveNodes).mock.calls.at(-1)?.[0];
    expect(saveArg?.[0]?.last_heard).toBe(900);
  });

  it('rebuilds retry payload from current store when saveNodes rejects', async () => {
    const saveNodes = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockImplementation((nodes: { last_heard: number }[]) =>
        Promise.resolve({ saved: nodes.length, dropped: 0 }),
      );
    window.electronAPI.db.saveNodes = saveNodes;
    const retrySpy = vi.spyOn(await import('../dbPersistRetry'), 'persistDbWrite');
    enqueueNodeWrite(ID_A, record(88, { lastHeardAt: 100 }));
    await flushNodeWrites();
    upsertNodeRecord(ID_A, { nodeId: 88, lastHeardAt: 800 });
    const retryWrite = retrySpy.mock.calls[0]?.[1];
    expect(retryWrite).toBeTypeOf('function');
    await retryWrite();
    const saveArg = saveNodes.mock.calls.at(-1)?.[0];
    expect(saveArg?.[0]?.last_heard).toBe(800);
  });
});
