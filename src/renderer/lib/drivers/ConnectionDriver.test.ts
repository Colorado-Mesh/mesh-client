import { beforeEach, describe, expect, it } from 'vitest';

import { addIdentity } from '../../stores/identityStore';
import { meshtasticProtocol } from '../protocols/MeshtasticProtocol';
import { connectionDriver } from './ConnectionDriver';

describe('ConnectionDriver', () => {
  beforeEach(() => {
    // Each test uses a fresh identity id; no global store reset required.
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
});
