// @vitest-environment jsdom
/**
 * Behavioral: hop/CU/packet observations must survive coalesced node persistence.
 * Analysis stays debounced in diagnosticsStore; this file only asserts recording.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { useNodeStore } from '../../stores/nodeStore';
import {
  enqueueNodeWrite,
  flushNodeWrites,
  resetCoalescedNodeWritesForTests,
} from '../ingest/coalescedNodeWrites';
import { MESH_PROTOCOL_STORAGE_KEY } from '../storedMeshProtocol';
import { meshNodeToNodeRecord } from '../storeRecordAdapters';
import type { MeshNode } from '../types';
import { processMeshtasticNodeDiagnostics } from './meshtasticProcessNodeDiagnostics';

describe('meshtastic diagnostics coalesced hop observations', () => {
  const ID = 'id-mesh-diag';
  const NODE_ID = 42;

  beforeEach(() => {
    vi.useFakeTimers();
    resetCoalescedNodeWritesForTests();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    useDiagnosticsStore.setState({
      hopHistory: new Map(),
      packetStats: new Map(),
      cuHistory: new Map(),
    });
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshtastic');
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

  it('retains hop 2 then hop 1 observations and packet counts within the coalesce window', async () => {
    const base: MeshNode = {
      node_id: NODE_ID,
      long_name: 'N',
      short_name: 'N',
      hw_model: 'TBeam',
      battery: 0,
      snr: 1,
      rssi: -80,
      last_heard: Date.now(),
      latitude: null,
      longitude: null,
    };

    const hop2 = { ...base, hops_away: 2 };
    const hop1 = { ...base, hops_away: 1, snr: 2 };
    enqueueNodeWrite(ID, meshNodeToNodeRecord(hop2), { persist: true });
    processMeshtasticNodeDiagnostics(hop2, 1, null);
    enqueueNodeWrite(ID, meshNodeToNodeRecord(hop1), { persist: true });
    processMeshtasticNodeDiagnostics(hop1, 1, null);

    const hops = useDiagnosticsStore.getState().hopHistory.get(NODE_ID) ?? [];
    expect(hops.map((p) => p.h)).toEqual([2, 1]);
    expect(useDiagnosticsStore.getState().packetStats.get(NODE_ID)?.total).toBe(2);

    processMeshtasticNodeDiagnostics({ ...hop1, channel_utilization: 10 }, 1, {
      ...hop1,
      channel_utilization: 10,
    });
    processMeshtasticNodeDiagnostics({ ...hop1, channel_utilization: 20 }, 1, {
      ...hop1,
      channel_utilization: 20,
    });
    const cu = useDiagnosticsStore.getState().cuHistory.get(NODE_ID) ?? [];
    expect(cu.map((s) => s.cu)).toEqual([10, 20]);

    await flushNodeWrites();
  });
});
