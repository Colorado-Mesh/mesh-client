import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pubkeyToNodeId } from '../meshcoreUtils';
import { mockConsoleWarn } from '../vitestConsoleMock';
import { clearMeshcoreRepeaters } from './meshcoreClearRepeaters';
import type { MeshCoreContactRaw } from './meshcoreHookTypes';

function key(seed: number): Uint8Array {
  const k = new Uint8Array(32);
  k[0] = seed;
  k[5] = seed * 3;
  return k;
}

function contact(seed: number, type: number): MeshCoreContactRaw {
  return {
    publicKey: key(seed),
    type,
    advName: `c${seed}`,
    lastAdvert: 0,
    advLat: 0,
    advLon: 0,
    flags: 0,
  };
}

describe('clearMeshcoreRepeaters', () => {
  beforeEach(() => {
    mockConsoleWarn();
  });

  it('removes only non-favorited repeaters from the radio and reports their ids', async () => {
    const rep = contact(1, 2);
    const favRep = contact(2, 2);
    const chat = contact(3, 1);
    const room = contact(4, 3);
    const removeContact = vi.fn().mockResolvedValue(undefined);
    const clearDbRepeaters = vi.fn().mockResolvedValue({ changes: 1 });
    const result = await clearMeshcoreRepeaters({
      conn: { getContacts: vi.fn().mockResolvedValue([rep, favRep, chat, room]), removeContact },
      selfNodeId: 99,
      nodes: new Map(),
      dbContacts: [
        { node_id: pubkeyToNodeId(favRep.publicKey), contact_type: 2, favorited: 1 },
        { node_id: 555, contact_type: 2, favorited: 0 },
        { node_id: 556, contact_type: 1, favorited: 0 },
      ],
      clearDbRepeaters,
    });
    expect(removeContact).toHaveBeenCalledTimes(1);
    expect(removeContact).toHaveBeenCalledWith(rep.publicKey);
    expect(clearDbRepeaters).toHaveBeenCalledTimes(1);
    expect(result.radioRemoveFailures).toBe(0);
    expect(new Set(result.removedNodeIds)).toEqual(new Set([555, pubkeyToNodeId(rep.publicKey)]));
  });

  it('skips self and UI-favorited repeaters', async () => {
    const self = contact(5, 2);
    const uiFav = contact(6, 2);
    const selfId = pubkeyToNodeId(self.publicKey);
    const uiFavId = pubkeyToNodeId(uiFav.publicKey);
    const removeContact = vi.fn().mockResolvedValue(undefined);
    const result = await clearMeshcoreRepeaters({
      conn: { getContacts: vi.fn().mockResolvedValue([self, uiFav]), removeContact },
      selfNodeId: selfId,
      nodes: new Map([
        [uiFavId, { hw_model: 'Repeater', favorited: true }],
        [777, { hw_model: 'Repeater' }],
        [778, { hw_model: 'Companion' }],
      ]),
      dbContacts: [],
      clearDbRepeaters: vi.fn().mockResolvedValue(undefined),
    });
    expect(removeContact).not.toHaveBeenCalled();
    expect(result.removedNodeIds).toEqual([777]);
  });

  it('continues past a failed radio removal and counts the failure', async () => {
    const a = contact(7, 2);
    const b = contact(8, 2);
    const removeContact = vi
      .fn()
      .mockRejectedValueOnce(new Error('rejected'))
      .mockResolvedValueOnce(undefined);
    const result = await clearMeshcoreRepeaters({
      conn: { getContacts: vi.fn().mockResolvedValue([a, b]), removeContact },
      selfNodeId: 0,
      nodes: new Map(),
      dbContacts: [],
      clearDbRepeaters: vi.fn().mockResolvedValue(undefined),
    });
    expect(removeContact).toHaveBeenCalledTimes(2);
    expect(result.radioRemoveFailures).toBe(1);
    expect(new Set(result.removedNodeIds)).toEqual(
      new Set([pubkeyToNodeId(a.publicKey), pubkeyToNodeId(b.publicKey)]),
    );
  });

  it('clears DB and UI ids only when disconnected', async () => {
    const clearDbRepeaters = vi.fn().mockResolvedValue(undefined);
    const result = await clearMeshcoreRepeaters({
      conn: null,
      selfNodeId: 0,
      nodes: new Map([[10, { hw_model: 'Repeater' }]]),
      dbContacts: [{ node_id: 11, contact_type: 2, favorited: 0 }],
      clearDbRepeaters,
    });
    expect(clearDbRepeaters).toHaveBeenCalledTimes(1);
    expect(result.radioRemoveFailures).toBe(0);
    expect(new Set(result.removedNodeIds)).toEqual(new Set([10, 11]));
  });

  it('rethrows DB failures', async () => {
    await expect(
      clearMeshcoreRepeaters({
        conn: null,
        selfNodeId: 0,
        nodes: new Map(),
        dbContacts: [],
        clearDbRepeaters: vi.fn().mockRejectedValue(new Error('db down')),
      }),
    ).rejects.toThrow('db down');
  });
});
