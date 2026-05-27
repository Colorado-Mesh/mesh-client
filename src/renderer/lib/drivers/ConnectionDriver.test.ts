import type { MeshDevice } from '@meshtastic/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../../stores/connectionStore';
import { addIdentity, getIdentity, useIdentityStore } from '../../stores/identityStore';
import { meshtasticProtocol } from '../protocols/MeshtasticProtocol';
import type { TransportParams } from '../types';
import { connectionDriver } from './ConnectionDriver';

describe('ConnectionDriver', () => {
  beforeEach(() => {
    // Each test uses a fresh identity id; no global store reset required.
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of Object.keys(useIdentityStore.getState().identities)) {
      await connectionDriver.removeIdentity(id).catch(() => {});
    }
    useConnectionStore.setState({ connections: {} });
  });

  it('registerLegacyTransport exposes handle to getHandle', () => {
    const identityId = `test-${Date.now()}`;
    addIdentity({
      id: identityId,
      protocol: meshtasticProtocol,
      signature: 'meshtastic:test:legacy',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    const fakeHandle = { kind: 'test-device' };
    const detach = connectionDriver.registerLegacyTransport(
      identityId,
      meshtasticProtocol,
      fakeHandle,
      'ble',
      { type: 'ble', peripheralId: 'aa:bb' },
      () => {},
    );
    expect(connectionDriver.getHandle(identityId)).toBe(fakeHandle);
    detach();
    expect(connectionDriver.getHandle(identityId)).toBeNull();
  });

  it('remapMeshtasticNodeSignature resolves identity by transport key after node discovery', () => {
    const identityId = `meshtastic-remap-${Date.now()}`;
    const params: TransportParams = { type: 'ble', peripheralId: `peripheral-${Date.now()}` };
    const provisionalKey = meshtasticProtocol.identitySignature(params);

    addIdentity({
      id: identityId,
      protocol: meshtasticProtocol,
      signature: provisionalKey,
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    connectionDriver.registerTransportKeys(identityId, provisionalKey);

    connectionDriver.remapMeshtasticNodeSignature(identityId, params, 9001);

    expect(getIdentity(identityId)?.signature).toBe('meshtastic:node:9001');
    expect(connectionDriver.lookupIdentityId(provisionalKey)).toBe(identityId);
    expect(connectionDriver.lookupIdentityId('meshtastic:node:9001')).toBe(identityId);
  });

  it('connect discovers self, registers transport keys, and disconnect cleans up', async () => {
    const peripheralId = `connect-${Date.now()}`;
    const params: TransportParams = { type: 'ble', peripheralId };
    const fakeHandle = { kind: 'mock-mesh-device' } as unknown as MeshDevice;

    vi.spyOn(meshtasticProtocol, 'createDevice').mockResolvedValue(fakeHandle);
    vi.spyOn(meshtasticProtocol, 'subscribe').mockReturnValue(() => {});
    vi.spyOn(meshtasticProtocol, 'destroyDevice').mockResolvedValue(undefined);

    const identityId = await connectionDriver.connect('meshtastic', params);
    expect(getIdentity(identityId)?.signature).toBe(`meshtastic:ble:${peripheralId}`);
    expect(connectionDriver.getHandle(identityId)).toBe(fakeHandle);
    expect(connectionDriver.lookupIdentityId(`meshtastic:ble:${peripheralId}`)).toBe(identityId);

    await connectionDriver.disconnect(identityId);
    expect(connectionDriver.getHandle(identityId)).toBeNull();
    expect(useConnectionStore.getState().connections[identityId]?.status).toBe('disconnected');
  });

  it('connect reuses identity when transport key was remapped to node signature', async () => {
    const peripheralId = `reuse-${Date.now()}`;
    const params: TransportParams = { type: 'ble', peripheralId };
    const existingId = `existing-${Date.now()}`;
    addIdentity({
      id: existingId,
      protocol: meshtasticProtocol,
      signature: 'meshtastic:node:777',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    connectionDriver.registerTransportKeys(
      existingId,
      `meshtastic:ble:${peripheralId}`,
      'meshtastic:node:777',
    );

    vi.spyOn(meshtasticProtocol, 'createDevice').mockResolvedValue({} as unknown as MeshDevice);
    vi.spyOn(meshtasticProtocol, 'subscribe').mockReturnValue(() => {});
    vi.spyOn(meshtasticProtocol, 'destroyDevice').mockResolvedValue(undefined);

    const identityId = await connectionDriver.connect('meshtastic', params);
    expect(identityId).toBe(existingId);
    expect(connectionDriver.lookupIdentityId(`meshtastic:ble:${peripheralId}`)).toBe(existingId);
    await connectionDriver.disconnect(identityId);
  });
});
