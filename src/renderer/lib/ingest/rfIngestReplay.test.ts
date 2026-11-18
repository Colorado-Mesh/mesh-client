/**
 * Deterministic RF / peer ingest replay for connect-burst scaling.
 *
 * Baseline (pre-coalesce on main): notifications ≈ records; saveNode ≈ records.
 * After Phase 1: notifications ≤ ~12 and saveNodes ≤ 8 for a dual LoRa 1000+1000 burst.
 */
/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNodeStore } from '../../stores/nodeStore';
import { syncNodesMapToIdentityStore } from '../hydrateIdentityStoresFromDb';
import { meshNodeToNodeRecord } from '../storeRecordAdapters';
import type { MeshNode } from '../types';
import {
  enqueueNodeWrite,
  flushNodeWrites,
  resetCoalescedNodeWritesForTests,
} from './coalescedNodeWrites';

const MT_ID = 'replay-meshtastic';
const MC_ID = 'replay-meshcore';
const RN_ID = 'replay-reticulum';

function emptyNode(nodeId: number): MeshNode {
  return {
    node_id: nodeId,
    long_name: `N${nodeId}`,
    short_name: `N${nodeId}`,
    hw_model: '',
    battery: 0,
    snr: 0,
    rssi: 0,
    last_heard: 1_700_000_000,
    latitude: null,
    longitude: null,
    source: 'rf',
  };
}

describe('rfIngestReplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCoalescedNodeWritesForTests();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    window.electronAPI = {
      db: {
        saveNodes: vi.fn().mockResolvedValue({ saved: 0, dropped: 0 }),
        saveNode: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    resetCoalescedNodeWritesForTests();
    vi.useRealTimers();
  });

  it('coalesces a 1000-node Meshtastic NodeDB-style burst', async () => {
    let notifications = 0;
    const unsub = useNodeStore.subscribe(() => {
      notifications += 1;
    });
    for (let i = 1; i <= 1000; i++) {
      enqueueNodeWrite(MT_ID, meshNodeToNodeRecord(emptyNode(i)), { persist: true });
    }
    await flushNodeWrites();
    unsub();
    // 1000 / 500 flush threshold → 2 flushes mid-burst (exact count depends on threshold timing).
    expect(notifications).toBeLessThanOrEqual(8);
    expect(window.electronAPI.db.saveNodes).toHaveBeenCalled();
    expect(Object.keys(useNodeStore.getState().nodes[MT_ID] ?? {})).toHaveLength(1000);
  });

  it('handles interleaved 1000/1000/1000 three-protocol burst with bounded notifications', async () => {
    let notifications = 0;
    const unsub = useNodeStore.subscribe(() => {
      notifications += 1;
    });

    // Seed MeshCore via already-batched path (contact sync reference).
    const mcMap = new Map<number, MeshNode>();
    for (let i = 1; i <= 1000; i++) mcMap.set(i, emptyNode(i));
    syncNodesMapToIdentityStore(MC_ID, mcMap);

    for (let i = 1; i <= 1000; i++) {
      enqueueNodeWrite(MT_ID, meshNodeToNodeRecord(emptyNode(i)), { persist: true });
      if (i % 2 === 0) {
        enqueueNodeWrite(MC_ID, meshNodeToNodeRecord({ ...emptyNode(i), snr: 2 }), {
          persist: true,
        });
      }
    }

    // Reticulum-shaped: one bulk upsert (simulates applyContactNodesFromStore single setState).
    const rnRecords = Array.from({ length: 1000 }, (_, i) =>
      meshNodeToNodeRecord({
        ...emptyNode(i + 1),
        reticulum_destination_hash: (i + 1).toString(16).padStart(32, '0'),
      }),
    );
    useNodeStore.setState((s) => {
      const byId: Record<number, (typeof rnRecords)[0]> = {};
      for (const r of rnRecords) byId[r.nodeId] = r;
      return { nodes: { ...s.nodes, [RN_ID]: byId } };
    });

    await flushNodeWrites();
    unsub();

    expect(notifications).toBeLessThanOrEqual(20);
    expect(Object.keys(useNodeStore.getState().nodes[MT_ID] ?? {})).toHaveLength(1000);
    expect(Object.keys(useNodeStore.getState().nodes[MC_ID] ?? {}).length).toBeGreaterThanOrEqual(
      1000,
    );
    expect(Object.keys(useNodeStore.getState().nodes[RN_ID] ?? {})).toHaveLength(1000);
  });
});
