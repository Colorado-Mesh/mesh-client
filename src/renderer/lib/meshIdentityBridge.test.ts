import type { MeshDevice } from '@meshtastic/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getIdentity } from '../stores/identityStore';
import { addMessage } from '../stores/messageStore';
import { connectionDriver } from './drivers/ConnectionDriver';
import { attachMeshtasticProtocolIngress, meshtasticTransportParams } from './meshIdentityBridge';
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

    const first = attachMeshtasticProtocolIngress(device, 'ble', { peripheralId });
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

    const second = attachMeshtasticProtocolIngress(device, 'ble', { peripheralId });
    expect(second.identityId).toBe(first.identityId);
    expect(getIdentity(second.identityId)?.signature).toBe('meshtastic:node:424242');
    second.detach();
  });
});

describe('meshtasticTransportParams', () => {
  it('maps tcp connection type to a tcp TransportParams', () => {
    expect(meshtasticTransportParams('tcp', { host: '192.168.200.4:4403' })).toEqual({
      type: 'tcp',
      host: '192.168.200.4:4403',
    });
  });

  it('defaults tcp host to empty string when omitted', () => {
    expect(meshtasticTransportParams('tcp', {})).toEqual({ type: 'tcp', host: '' });
  });
});
