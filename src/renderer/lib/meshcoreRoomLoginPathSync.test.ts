import { describe, expect, it, vi } from 'vitest';

import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import { syncMeshcoreRoomContactPathBeforeLogin } from './meshcoreRoomLoginPathSync';
import { pubkeyToNodeId } from './meshcoreUtils';

function makePubKey(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  key[0] = seed & 0xff;
  key[1] = (seed >>> 8) & 0xff;
  return key;
}

describe('syncMeshcoreRoomContactPathBeforeLogin', () => {
  it('skips direct (0-hop) rooms', async () => {
    const pubKey = makePubKey(1);
    const conn = { getContacts: vi.fn(), setContactPath: vi.fn() };
    const result = await syncMeshcoreRoomContactPathBeforeLogin(
      conn,
      pubkeyToNodeId(pubKey),
      pubKey,
      {
        long_name: 'R',
        hw_model: 'Room',
        hops_away: 0,
        latitude: null,
        longitude: null,
        last_heard: 0,
      },
      undefined,
      0,
    );
    expect(result.reason).toBe('direct');
    expect(conn.setContactPath).not.toHaveBeenCalled();
  });

  it('syncs path from map bytes before login (fast path, no getContacts)', async () => {
    const pubKey = makePubKey(0x39);
    const nodeId = pubkeyToNodeId(pubKey);
    const path = new Uint8Array([0x11, 0x22, 0x33, 0x44]);
    const addOrUpdateContact = vi.fn().mockResolvedValue(undefined);
    const getContacts = vi.fn();
    const result = await syncMeshcoreRoomContactPathBeforeLogin(
      { getContacts, setContactPath: vi.fn(), addOrUpdateContact },
      nodeId,
      pubKey,
      {
        long_name: 'Far Room',
        hw_model: 'Room',
        hops_away: 2,
        latitude: null,
        longitude: null,
        last_heard: 1,
      },
      path,
      2,
    );
    expect(result).toEqual({ synced: true, pathByteLen: 4, reason: 'synced' });
    expect(getContacts).not.toHaveBeenCalled();
    expect(addOrUpdateContact).toHaveBeenCalled();
    expect(addOrUpdateContact.mock.calls[0]?.[3]).toBe(3);
  });

  it('uses trimmed contact buffer when outPathLen is 0 but bytes exist', async () => {
    const pubKey = makePubKey(0xab);
    const nodeId = pubkeyToNodeId(pubKey);
    const outPath = new Uint8Array(64);
    outPath[0] = 0xaa;
    outPath[1] = 0xbb;
    outPath[2] = 0xcc;
    const contact: MeshCoreContactRaw = {
      publicKey: pubKey,
      type: 3,
      flags: 0,
      advName: 'Room',
      lastAdvert: 1,
      advLat: 0,
      advLon: 0,
      outPathLen: 0,
      outPath,
    };
    const addOrUpdateContact = vi.fn().mockResolvedValue(undefined);
    const result = await syncMeshcoreRoomContactPathBeforeLogin(
      {
        getContacts: vi.fn().mockResolvedValue([contact]),
        setContactPath: vi.fn(),
        addOrUpdateContact,
      },
      nodeId,
      pubKey,
      {
        long_name: 'Room',
        hw_model: 'Room',
        hops_away: 2,
        latitude: null,
        longitude: null,
        last_heard: 1,
      },
      undefined,
      2,
    );
    expect(result.reason).toBe('synced');
    expect(addOrUpdateContact).toHaveBeenCalled();
  });
});

describe('resetMeshcoreRoomCompanionSyncSinceForCatchUp', () => {
  it('skips when remove/add APIs are missing', async () => {
    const pubKey = makePubKey(2);
    const conn = { getContacts: vi.fn(), setContactPath: vi.fn() };
    const { resetMeshcoreRoomCompanionSyncSinceForCatchUp } =
      await import('./meshcoreRoomLoginPathSync');
    await expect(
      resetMeshcoreRoomCompanionSyncSinceForCatchUp(conn, pubkeyToNodeId(pubKey), pubKey),
    ).resolves.toBe('skipped');
  });

  it('remove+readds room contact to zero companion sync_since', async () => {
    const pubKey = makePubKey(0x40);
    const nodeId = pubkeyToNodeId(pubKey);
    const contact: MeshCoreContactRaw = {
      publicKey: pubKey,
      type: 3,
      flags: 0,
      outPathLen: 0,
      outPath: new Uint8Array(64),
      advName: 'CatchUp Room',
      lastAdvert: 1,
      advLat: 0,
      advLon: 0,
    };
    const removeContact = vi.fn().mockResolvedValue(undefined);
    const addOrUpdateContact = vi.fn().mockResolvedValue(undefined);
    const conn = {
      getContacts: vi.fn().mockResolvedValue([contact]),
      setContactPath: vi.fn(),
      removeContact,
      addOrUpdateContact,
    };
    const { resetMeshcoreRoomCompanionSyncSinceForCatchUp } =
      await import('./meshcoreRoomLoginPathSync');
    await expect(resetMeshcoreRoomCompanionSyncSinceForCatchUp(conn, nodeId, pubKey)).resolves.toBe(
      'reset',
    );
    expect(removeContact).toHaveBeenCalledWith(pubKey);
    expect(addOrUpdateContact).toHaveBeenCalled();
  });

  it('retries add after remove if the first add fails', async () => {
    const pubKey = makePubKey(0x41);
    const nodeId = pubkeyToNodeId(pubKey);
    const contact: MeshCoreContactRaw = {
      publicKey: pubKey,
      type: 3,
      flags: 0,
      outPathLen: 0,
      outPath: new Uint8Array(64),
      advName: 'Retry Room',
      lastAdvert: 1,
      advLat: 0,
      advLon: 0,
    };
    const removeContact = vi.fn().mockResolvedValue(undefined);
    const addOrUpdateContact = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);
    const conn = {
      getContacts: vi.fn().mockResolvedValue([contact]),
      setContactPath: vi.fn(),
      removeContact,
      addOrUpdateContact,
    };
    const { resetMeshcoreRoomCompanionSyncSinceForCatchUp } =
      await import('./meshcoreRoomLoginPathSync');
    await expect(resetMeshcoreRoomCompanionSyncSinceForCatchUp(conn, nodeId, pubKey)).resolves.toBe(
      'reset',
    );
    expect(removeContact).toHaveBeenCalledTimes(1);
    expect(addOrUpdateContact).toHaveBeenCalledTimes(2);
  });

  it('returns failed when both add attempts reject after remove', async () => {
    const pubKey = makePubKey(0x44);
    const nodeId = pubkeyToNodeId(pubKey);
    const contact: MeshCoreContactRaw = {
      publicKey: pubKey,
      type: 3,
      flags: 0,
      outPathLen: 0,
      outPath: new Uint8Array(64),
      advName: 'Missing Room',
      lastAdvert: 1,
      advLat: 0,
      advLon: 0,
    };
    const removeContact = vi.fn().mockResolvedValue(undefined);
    const addOrUpdateContact = vi.fn().mockRejectedValue(new Error('timeout'));
    const conn = {
      getContacts: vi.fn().mockResolvedValue([contact]),
      setContactPath: vi.fn(),
      removeContact,
      addOrUpdateContact,
    };
    const { resetMeshcoreRoomCompanionSyncSinceForCatchUp } =
      await import('./meshcoreRoomLoginPathSync');
    await expect(resetMeshcoreRoomCompanionSyncSinceForCatchUp(conn, nodeId, pubKey)).resolves.toBe(
      'failed',
    );
    expect(removeContact).toHaveBeenCalledTimes(1);
    expect(addOrUpdateContact).toHaveBeenCalledTimes(2);
  });

  it('invokes catch-up remove/add with conn as this', async () => {
    const pubKey = makePubKey(0x43);
    const nodeId = pubkeyToNodeId(pubKey);
    const contact: MeshCoreContactRaw = {
      publicKey: pubKey,
      type: 3,
      flags: 0,
      outPathLen: 0,
      outPath: new Uint8Array(64),
      advName: 'This Room',
      lastAdvert: 1,
      advLat: 0,
      advLon: 0,
    };
    const conn = {
      commands: [] as string[],
      getContacts() {
        return Promise.resolve([contact]);
      },
      setContactPath: vi.fn(),
      removeContact(this: { commands: string[] }) {
        this.commands.push('remove');
        return Promise.resolve();
      },
      addOrUpdateContact(this: { commands: string[] }) {
        this.commands.push('add');
        return Promise.resolve();
      },
    };
    const { resetMeshcoreRoomCompanionSyncSinceForCatchUp } =
      await import('./meshcoreRoomLoginPathSync');
    await expect(resetMeshcoreRoomCompanionSyncSinceForCatchUp(conn, nodeId, pubKey)).resolves.toBe(
      'reset',
    );
    expect(conn.commands).toEqual(['remove', 'add']);
  });

  it('skips catch-up reset when the login abort signal is already aborted', async () => {
    const pubKey = makePubKey(0x42);
    const conn = {
      getContacts: vi.fn(),
      setContactPath: vi.fn(),
      removeContact: vi.fn(),
      addOrUpdateContact: vi.fn(),
    };
    const { resetMeshcoreRoomCompanionSyncSinceForCatchUp } =
      await import('./meshcoreRoomLoginPathSync');
    const signal = AbortSignal.abort();
    await expect(
      resetMeshcoreRoomCompanionSyncSinceForCatchUp(conn, pubkeyToNodeId(pubKey), pubKey, signal),
    ).resolves.toBe('skipped');
    expect(conn.getContacts).not.toHaveBeenCalled();
    expect(conn.removeContact).not.toHaveBeenCalled();
  });
});
