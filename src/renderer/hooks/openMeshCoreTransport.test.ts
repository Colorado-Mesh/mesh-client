import type { Connection } from '@liamcottle/meshcore.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { openMeshCoreTransport } from './openMeshCoreTransport';

describe('openMeshCoreTransport', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of Object.keys(useIdentityStore.getState().identities)) {
      await connectionDriver.removeIdentity(id).catch(() => {});
    }
    useConnectionStore.setState({ connections: {} });
  });

  it('connects via ConnectionDriver and returns identity id', async () => {
    const fakeConn = { kind: 'meshcore-mock' } as unknown as Connection;
    vi.spyOn(meshcoreProtocol, 'createDevice').mockResolvedValue(fakeConn);
    vi.spyOn(meshcoreProtocol, 'subscribe').mockReturnValue(() => {});
    vi.spyOn(meshcoreProtocol, 'destroyDevice').mockResolvedValue(undefined);
    vi.spyOn(meshcoreProtocol, 'discoverSelf').mockResolvedValue({
      publicKey: new Uint8Array(32).fill(7),
    });

    const { conn, driverIdentityId } = await openMeshCoreTransport('tcp', {
      host: '127.0.0.1:5000',
    });
    expect(conn).toBe(fakeConn);
    expect(driverIdentityId).toBeTruthy();
    expect(connectionDriver.getHandle(driverIdentityId)).toBe(fakeConn);

    await connectionDriver.disconnect(driverIdentityId);
  });

  it('disconnects driver slot when connect succeeds but getHandle is null', async () => {
    const fakeConn = { kind: 'meshcore-mock' } as unknown as Connection;
    vi.spyOn(meshcoreProtocol, 'createDevice').mockResolvedValue(fakeConn);
    vi.spyOn(meshcoreProtocol, 'subscribe').mockReturnValue(() => {});
    vi.spyOn(meshcoreProtocol, 'destroyDevice').mockResolvedValue(undefined);
    vi.spyOn(meshcoreProtocol, 'discoverSelf').mockResolvedValue({
      publicKey: new Uint8Array(32).fill(7),
    });
    const disconnectSpy = vi.spyOn(connectionDriver, 'disconnect');
    vi.spyOn(connectionDriver, 'getHandle').mockReturnValue(null);

    await expect(openMeshCoreTransport('tcp', { host: '127.0.0.1:5000' })).rejects.toThrow(
      'no handle',
    );
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
