import type { MeshDevice } from '@meshtastic/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getIdentity } from '../stores/identityStore';
import { addMessage } from '../stores/messageStore';
import { connectionDriver } from './drivers/ConnectionDriver';
import { bindMeshtasticIngress } from './meshIdentityBridge';
import { meshtasticProtocol } from './protocols/MeshtasticProtocol';

function mockMeshDevice(): MeshDevice {
  return { events: {} } as unknown as MeshDevice;
}

describe('meshIdentityBridge', () => {
  beforeEach(() => {
    vi.spyOn(meshtasticProtocol, 'subscribe').mockReturnValue(() => {});
  });

  it('reconnects the same BLE device to the same identity after myNodeNum remap', () => {
    const peripheralId = `ble-${Date.now()}`;
    const device = mockMeshDevice();

    const first = bindMeshtasticIngress(device, 'ble', { peripheralId });
    addMessage(first.identityId, {
      id: 'msg-1',
      from: 1,
      to: 0,
      payload: 'hello',
      channelIndex: 0,
      timestamp: Date.now(),
    });

    connectionDriver.remapMeshtasticNodeSignature(
      first.identityId,
      { type: 'ble', peripheralId },
      424242,
    );
    first.detach();

    const second = bindMeshtasticIngress(device, 'ble', { peripheralId });
    expect(second.identityId).toBe(first.identityId);
    expect(getIdentity(second.identityId)?.signature).toBe('meshtastic:node:424242');
    second.detach();
  });
});
