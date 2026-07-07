import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import { resolveMeshcoreRoomLoginRouteBytes } from './meshcoreRoomLoginRouteResolve';
import * as tracePrime from './meshcoreTraceRoutePrime';
import { pubkeyToNodeId } from './meshcoreUtils';

const pubKey = (() => {
  const b = new Uint8Array(32);
  b[0] = 0xab;
  b[1] = 0xcd;
  return b;
})();
const nodeId = pubkeyToNodeId(pubKey);

function baseConn(overrides: Record<string, unknown> = {}) {
  return {
    getContacts: vi.fn(() => Promise.resolve([])),
    sendFloodAdvert: vi.fn(() => Promise.resolve()),
    sendCommandSendTracePath: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  };
}

function radioContact(overrides: Partial<MeshCoreContactRaw> = {}): MeshCoreContactRaw {
  return {
    publicKey: pubKey,
    type: 2,
    advName: 'ROOM',
    lastAdvert: 1,
    advLat: 0,
    advLon: 0,
    flags: 0,
    outPathLen: 1,
    outPath: new Uint8Array([0x11, 0x22, 0, 0]),
    ...overrides,
  };
}

describe('resolveMeshcoreRoomLoginRouteBytes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skipTrace avoids flood advert and active trace', async () => {
    const sendFloodAdvert = vi.fn(() => Promise.resolve());
    const sendCommandSendTracePath = vi.fn(() => Promise.resolve());

    const conn = baseConn({ sendFloodAdvert, sendCommandSendTracePath });

    const result = await resolveMeshcoreRoomLoginRouteBytes(conn, nodeId, {
      pubKey,
      loginHopsAway: 2,
      skipTrace: true,
      allowPrime: false,
    });

    expect(result).toBeUndefined();
    expect(sendFloodAdvert).not.toHaveBeenCalled();
    expect(sendCommandSendTracePath).not.toHaveBeenCalled();
  });

  it('returns outPathFromMap for 0-hop without radio I/O', async () => {
    const oneBytePath = new Uint8Array([0xab]);
    const getContacts = vi.fn(() => Promise.resolve([]));
    const conn = baseConn({ getContacts });

    const result = await resolveMeshcoreRoomLoginRouteBytes(conn, nodeId, {
      pubKey,
      loginHopsAway: 0,
      outPathFromMap: oneBytePath,
    });

    expect(result).toEqual(oneBytePath);
    expect(getContacts).not.toHaveBeenCalled();
  });

  it('returns undefined for 0-hop when outPathFromMap is empty', async () => {
    const conn = baseConn();

    const result = await resolveMeshcoreRoomLoginRouteBytes(conn, nodeId, {
      pubKey,
      loginHopsAway: 0,
    });

    expect(result).toBeUndefined();
    expect(conn.getContacts).not.toHaveBeenCalled();
  });

  it('returns multi-byte outPathFromMap without calling getContacts', async () => {
    const mapPath = new Uint8Array([0x11, 0x22]);
    const getContacts = vi.fn(() => Promise.resolve([]));
    const conn = baseConn({ getContacts });

    const result = await resolveMeshcoreRoomLoginRouteBytes(conn, nodeId, {
      pubKey,
      loginHopsAway: 2,
      outPathFromMap: mapPath,
    });

    expect(result).toEqual(mapPath);
    expect(getContacts).not.toHaveBeenCalled();
  });

  it('returns path from getContacts when map has no usable route', async () => {
    const conn = baseConn({
      getContacts: vi.fn(() => Promise.resolve([radioContact()])),
    });

    const result = await resolveMeshcoreRoomLoginRouteBytes(conn, nodeId, {
      pubKey,
      loginHopsAway: 2,
      skipTrace: true,
    });

    expect(result).toEqual(new Uint8Array([0x11, 0x22]));
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
  });

  it('uses flood prime when contacts have no usable multi-hop path', async () => {
    const primedPath = new Uint8Array([0xaa, 0xbb]);
    const primeSpy = vi.spyOn(tracePrime, 'primeMeshcoreTraceRouteWithFallback').mockResolvedValue({
      path: primedPath,
      radioContactPathLen: 2,
    });
    const conn = baseConn({
      getContacts: vi.fn(() => Promise.resolve([])),
    });

    const result = await resolveMeshcoreRoomLoginRouteBytes(conn, nodeId, {
      pubKey,
      loginHopsAway: 2,
      allowPrime: true,
    });

    expect(primeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conn,
        nodeId,
        pubKey,
        hopsAway: 2,
        initialStrategy: 'passive',
      }),
    );
    expect(result).toEqual(primedPath);
  });

  it('escalates passive prime to flood when loginHopsAway >= 2 and passive fails', async () => {
    const primeSpy = vi.spyOn(tracePrime, 'primeMeshcoreTraceRouteWithFallback').mockResolvedValue({
      path: new Uint8Array([0xaa, 0xbb]),
      radioContactPathLen: 2,
    });
    const conn = baseConn({
      getContacts: vi.fn(() => Promise.resolve([])),
    });

    await resolveMeshcoreRoomLoginRouteBytes(conn, nodeId, {
      pubKey,
      loginHopsAway: 2,
      allowPrime: true,
    });

    expect(primeSpy).toHaveBeenCalledTimes(1);
    const floodWhen = primeSpy.mock.calls[0]?.[0]?.floodWhen;
    expect(floodWhen?.({ usableAfterPrime: false } as never, 2)).toBe(true);
    expect(floodWhen?.({ usableAfterPrime: true } as never, 2)).toBe(false);
    expect(floodWhen?.({ usableAfterPrime: false } as never, 1)).toBe(false);
  });

  it('returns pathFromHistory without getContacts or prime', async () => {
    const historyPath = new Uint8Array([0x44, 0x55]);
    const primeSpy = vi.spyOn(tracePrime, 'primeMeshcoreTraceRouteWithFallback');
    const conn = baseConn({
      getContacts: vi.fn(() => Promise.resolve([])),
    });

    const result = await resolveMeshcoreRoomLoginRouteBytes(conn, nodeId, {
      pubKey,
      loginHopsAway: 2,
      pathFromHistory: historyPath,
    });

    expect(result).toEqual(historyPath);
    expect(conn.getContacts).not.toHaveBeenCalled();
    expect(primeSpy).not.toHaveBeenCalled();
  });

  it('swallows getContacts failure and may still prime', async () => {
    const primedPath = new Uint8Array([0xde, 0xef]);
    const primeSpy = vi.spyOn(tracePrime, 'primeMeshcoreTraceRouteWithFallback').mockResolvedValue({
      path: primedPath,
      radioContactPathLen: null,
    });
    const conn = baseConn({
      getContacts: vi.fn(() => Promise.reject(new Error('radio offline'))),
    });

    const result = await resolveMeshcoreRoomLoginRouteBytes(conn, nodeId, {
      pubKey,
      loginHopsAway: 2,
      allowPrime: true,
    });

    expect(conn.getContacts).toHaveBeenCalledTimes(1);
    expect(primeSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(primedPath);
  });
});
