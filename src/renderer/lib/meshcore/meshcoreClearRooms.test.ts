import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_CONTACT_TYPE_ROOM } from '@/shared/meshcoreContactHwLabels';

import { pubkeyToNodeId } from '../meshcoreUtils';
import { mockConsoleWarn } from '../vitestConsoleMock';
import { clearMeshcoreRooms } from './meshcoreClearRooms';
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

describe('clearMeshcoreRooms', () => {
  beforeEach(() => {
    mockConsoleWarn();
  });

  it('removes only non-favorited rooms from the radio and reports their ids', async () => {
    const room = contact(1, MESHCORE_CONTACT_TYPE_ROOM);
    const favRoom = contact(2, MESHCORE_CONTACT_TYPE_ROOM);
    const chat = contact(3, 1);
    const repeater = contact(4, 2);
    const removeContact = vi.fn().mockResolvedValue(undefined);
    const clearDbRooms = vi.fn().mockResolvedValue({ changes: 1 });
    const result = await clearMeshcoreRooms({
      conn: {
        getContacts: vi.fn().mockResolvedValue([room, favRoom, chat, repeater]),
        removeContact,
      },
      selfNodeId: 99,
      nodes: new Map(),
      dbContacts: [
        { node_id: pubkeyToNodeId(favRoom.publicKey), contact_type: 3, favorited: 1 },
        { node_id: 555, contact_type: 3, favorited: 0 },
        { node_id: 556, contact_type: 1, favorited: 0 },
      ],
      clearDbRooms,
    });
    expect(removeContact).toHaveBeenCalledTimes(1);
    expect(removeContact).toHaveBeenCalledWith(room.publicKey);
    expect(clearDbRooms).toHaveBeenCalledTimes(1);
    expect(result.radioRemoveFailures).toBe(0);
    expect(new Set(result.removedNodeIds)).toEqual(new Set([555, pubkeyToNodeId(room.publicKey)]));
  });

  it('skips self and UI-favorited rooms', async () => {
    const self = contact(5, MESHCORE_CONTACT_TYPE_ROOM);
    const uiFav = contact(6, MESHCORE_CONTACT_TYPE_ROOM);
    const selfId = pubkeyToNodeId(self.publicKey);
    const uiFavId = pubkeyToNodeId(uiFav.publicKey);
    const removeContact = vi.fn().mockResolvedValue(undefined);
    const result = await clearMeshcoreRooms({
      conn: { getContacts: vi.fn().mockResolvedValue([self, uiFav]), removeContact },
      selfNodeId: selfId,
      nodes: new Map([
        [uiFavId, { hw_model: 'Room', favorited: true }],
        [777, { hw_model: 'Room' }],
        [778, { hw_model: 'Companion' }],
      ]),
      dbContacts: [],
      clearDbRooms: vi.fn().mockResolvedValue(undefined),
    });
    expect(removeContact).not.toHaveBeenCalled();
    expect(result.removedNodeIds).toEqual([777]);
  });

  it('clears DB and UI ids only when disconnected', async () => {
    const clearDbRooms = vi.fn().mockResolvedValue(undefined);
    const result = await clearMeshcoreRooms({
      conn: null,
      selfNodeId: 0,
      nodes: new Map([[10, { hw_model: 'Room' }]]),
      dbContacts: [{ node_id: 11, contact_type: 3, favorited: 0 }],
      clearDbRooms,
    });
    expect(clearDbRooms).toHaveBeenCalledTimes(1);
    expect(result.radioRemoveFailures).toBe(0);
    expect(new Set(result.removedNodeIds)).toEqual(new Set([10, 11]));
  });

  it('rethrows DB failures', async () => {
    await expect(
      clearMeshcoreRooms({
        conn: null,
        selfNodeId: 0,
        nodes: new Map(),
        dbContacts: [],
        clearDbRooms: vi.fn().mockRejectedValue(new Error('db down')),
      }),
    ).rejects.toThrow('db down');
  });
});
