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

  it('registerExternalTransport exposes handle to getHandle', () => {
    const identityId = `test-${Date.now()}`;
    addIdentity({
      id: identityId,
      protocol: meshtasticProtocol,
      signature: 'meshtastic:test:external',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    const fakeHandle = { kind: 'test-device' };
    const detach = connectionDriver.registerExternalTransport(
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

  it('connect maps a tcp transport to a tcp connectionType, not null', async () => {
    const host = `tcp-host-${Date.now()}`;
    const params: TransportParams = { type: 'tcp', host };
    const fakeHandle = { kind: 'mock-tcp-device' } as unknown as MeshDevice;

    vi.spyOn(meshtasticProtocol, 'createDevice').mockResolvedValue(fakeHandle);
    vi.spyOn(meshtasticProtocol, 'subscribe').mockReturnValue(() => {});
    vi.spyOn(meshtasticProtocol, 'destroyDevice').mockResolvedValue(undefined);

    const identityId = await connectionDriver.connect('meshtastic', params);
    expect(useConnectionStore.getState().connections[identityId]?.connectionType).toBe('tcp');

    await connectionDriver.disconnect(identityId);
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

  it('bounds the signature alias table but keeps aliases of connected identities', async () => {
    const peripheralId = `alias-bound-${Date.now()}`;
    const params: TransportParams = { type: 'ble', peripheralId };
    vi.spyOn(meshtasticProtocol, 'createDevice').mockResolvedValue({} as unknown as MeshDevice);
    vi.spyOn(meshtasticProtocol, 'subscribe').mockReturnValue(() => {});
    vi.spyOn(meshtasticProtocol, 'destroyDevice').mockResolvedValue(undefined);

    const connectedId = await connectionDriver.connect('meshtastic', params);
    const connectedKey = `meshtastic:ble:${peripheralId}`;

    const staleId = `stale-${Date.now()}`;
    addIdentity({
      id: staleId,
      protocol: meshtasticProtocol,
      signature: 'meshtastic:node:stale-signature',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    for (let i = 0; i < 600; i++) {
      connectionDriver.registerTransportKeys(staleId, `meshtastic:ble:stale-${i}`);
    }

    expect(connectionDriver.lookupIdentityId(connectedKey)).toBe(connectedId);
    expect(connectionDriver.lookupIdentityId('meshtastic:ble:stale-0')).toBeNull();
    expect(connectionDriver.lookupIdentityId('meshtastic:ble:stale-599')).toBe(staleId);

    await connectionDriver.disconnect(connectedId);
  });

  it('removeIdentity clears transport keys and identity record', async () => {
    const peripheralId = `remove-${Date.now()}`;
    const transportKey = `meshtastic:ble:${peripheralId}`;
    const identityId = `remove-id-${Date.now()}`;
    addIdentity({
      id: identityId,
      protocol: meshtasticProtocol,
      signature: transportKey,
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    connectionDriver.registerTransportKeys(identityId, transportKey);

    await connectionDriver.removeIdentity(identityId);

    expect(connectionDriver.lookupIdentityId(transportKey)).toBeNull();
    expect(getIdentity(identityId)).toBeNull();
    expect(useConnectionStore.getState().connections[identityId]).toBeUndefined();
  });
});
