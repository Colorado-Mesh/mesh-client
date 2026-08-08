import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePathHistoryStore } from '../../stores/pathHistoryStore';
import { pubkeyToNodeId } from '../meshcoreUtils';
import type { MeshNode } from '../types';
import type { MeshCoreConnection, MeshCoreContactRaw } from './meshcoreHookTypes';
import {
  rebuildMeshcoreContactsAfterPathUpdated,
  refreshMeshcoreOutPathAfterPathUpdated,
} from './meshcorePathUpdatedRuntime';

function makePubKey(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  key[0] = seed;
  key[1] = seed + 1;
  return key;
}

function contact(
  overrides: Partial<MeshCoreContactRaw> & { publicKey: Uint8Array },
): MeshCoreContactRaw {
  return {
    type: 1,
    advName: 'Peer',
    lastAdvert: 1_700_000_000,
    advLat: 0,
    advLon: 0,
    flags: 0,
    ...overrides,
  };
}

describe('meshcorePathUpdatedRuntime', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      electronAPI: {
        db: {
          upsertMeshcorePathHistory: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    usePathHistoryStore.setState({ records: new Map(), lruOrder: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refreshMeshcoreOutPathAfterPathUpdated stores outPath and clears pending', async () => {
    const publicKey = makePubKey(10);
    const nodeId = pubkeyToNodeId(publicKey);
    const outPath = Uint8Array.from([0xab, 0xcd]);
    const conn = {
      getContacts: vi
        .fn()
        .mockResolvedValue([
          contact({ publicKey, outPathLen: 2, outPath }),
          contact({ publicKey: makePubKey(99), outPathLen: 1, outPath: Uint8Array.from([0x11]) }),
        ]),
    } as unknown as MeshCoreConnection;
    const outPathMap = new Map<number, Uint8Array>();
    const pending = new Set<number>([nodeId]);

    await refreshMeshcoreOutPathAfterPathUpdated(conn, nodeId, outPathMap, pending);

    expect(outPathMap.get(nodeId)).toEqual(outPath);
    expect(pending.has(nodeId)).toBe(false);
    expect(usePathHistoryStore.getState().records.get(nodeId)?.length).toBeGreaterThan(0);
  });

  it('refreshMeshcoreOutPathAfterPathUpdated leaves pending when getContacts fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const publicKey = makePubKey(11);
    const nodeId = pubkeyToNodeId(publicKey);
    const conn = {
      getContacts: vi.fn().mockRejectedValue(new Error('getContacts timeout')),
    } as unknown as MeshCoreConnection;
    const pending = new Set<number>([nodeId]);

    await refreshMeshcoreOutPathAfterPathUpdated(conn, nodeId, new Map(), pending);

    expect(pending.has(nodeId)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[meshcorePathUpdatedRuntime] getContacts refresh failed'),
    );
  });

  it('rebuildMeshcoreContactsAfterPathUpdated rebuilds nodes and records pending paths', async () => {
    const publicKey = makePubKey(12);
    const nodeId = pubkeyToNodeId(publicKey);
    const outPath = Uint8Array.from([0x01, 0x02, 0x03]);
    const contacts = [contact({ publicKey, outPathLen: 3, outPath, advName: 'Relay' })];
    const conn = {
      getContacts: vi.fn().mockResolvedValue(contacts),
    } as unknown as MeshCoreConnection;
    const onContacts = vi.fn();
    const onNodes = vi.fn();
    const nodeMap = new Map<number, MeshNode>([
      [
        nodeId,
        {
          node_id: nodeId,
          long_name: 'Relay',
          short_name: '',
          hw_model: 'Repeater',
          snr: 0,
          rssi: 0,
          last_heard: 0,
          battery: 0,
          latitude: null,
          longitude: null,
          hops_away: 2,
        },
      ],
    ]);
    const buildNodesFromContacts = vi.fn().mockResolvedValue(nodeMap);

    await rebuildMeshcoreContactsAfterPathUpdated({
      conn,
      buildNodesFromContacts,
      self: null,
      myNodeId: 1,
      previousNodes: new Map(),
      pendingPathUpdateNodeIds: new Set([nodeId]),
      onContacts,
      onNodes,
    });

    expect(onContacts).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ publicKey, flags: 0 })]),
    );
    expect(onNodes).toHaveBeenCalledWith(nodeMap);
    expect(buildNodesFromContacts).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ contactsFromRadio: true }),
    );
    expect(usePathHistoryStore.getState().records.has(nodeId)).toBe(true);
  });

  it('rebuildMeshcoreContactsAfterPathUpdated marks contacts on-radio even with no pending ids', async () => {
    // Regression: a debounced rebuild after a live sync must not re-save contacts with
    // on_radio=0. The helper signals this by passing contactsFromRadio: true to the builder.
    const publicKey = makePubKey(21);
    const nodeId = pubkeyToNodeId(publicKey);
    const contacts = [contact({ publicKey, outPathLen: 0, advName: 'Direct' })];
    const conn = {
      getContacts: vi.fn().mockResolvedValue(contacts),
    } as unknown as MeshCoreConnection;
    const buildNodesFromContacts = vi.fn().mockResolvedValue(new Map<number, MeshNode>());

    await rebuildMeshcoreContactsAfterPathUpdated({
      conn,
      buildNodesFromContacts,
      self: null,
      myNodeId: 1,
      previousNodes: new Map(),
      pendingPathUpdateNodeIds: new Set(),
      onContacts: vi.fn(),
      onNodes: vi.fn(),
    });

    expect(buildNodesFromContacts).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ contactsFromRadio: true }),
    );
    // No pending ids and no outPath → no path-history rows written.
    expect(usePathHistoryStore.getState().records.has(nodeId)).toBe(false);
  });

  it('rebuildMeshcoreContactsAfterPathUpdated logs and keeps prior nodes on failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onContacts = vi.fn();
    const onNodes = vi.fn();
    const conn = {
      getContacts: vi.fn().mockRejectedValue(new Error('radio busy')),
    } as unknown as MeshCoreConnection;

    await rebuildMeshcoreContactsAfterPathUpdated({
      conn,
      buildNodesFromContacts: vi.fn(),
      self: null,
      myNodeId: 1,
      previousNodes: new Map(),
      pendingPathUpdateNodeIds: new Set([7]),
      onContacts,
      onNodes,
    });

    expect(onContacts).not.toHaveBeenCalled();
    expect(onNodes).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[meshcorePathUpdatedRuntime] debounced contacts refresh error'),
    );
  });
});
