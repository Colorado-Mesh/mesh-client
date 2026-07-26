import type { MeshDevice } from '@meshtastic/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getIdentity } from '../stores/identityStore';
import { addMessage } from '../stores/messageStore';
import { connectionDriver } from './drivers/ConnectionDriver';
import {
  attachMeshtasticProtocolIngress,
  meshcoreTransportParams,
  meshtasticTransportParams,
} from './meshIdentityBridge';
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

  it('maps ble and serial identifiers through unchanged', () => {
    expect(meshtasticTransportParams('ble', { peripheralId: 'aa:bb' })).toEqual({
      type: 'ble',
      peripheralId: 'aa:bb',
    });
    expect(meshtasticTransportParams('serial', { portSignature: 'usb-1a86' })).toEqual({
      type: 'serial',
      portSignature: 'usb-1a86',
    });
    expect(meshtasticTransportParams('http', { host: '10.0.0.5' })).toEqual({
      type: 'http',
      host: '10.0.0.5',
    });
  });

  it('throws on an unsupported connection type', () => {
    expect(() => meshtasticTransportParams('carrier-pigeon' as unknown as 'tcp', {})).toThrow(
      /meshtasticTransportParams/,
    );
  });
});

describe('transport params parity', () => {
  const shared = [
    ['ble', { peripheralId: 'aa:bb:cc' }],
    ['serial', { portSignature: 'usb-1a86-0001' }],
    ['tcp', { host: '192.168.1.9:4403' }],
  ] as const;

  it.each(shared)('meshtastic and meshcore shape %s params identically', (type, opts) => {
    // A divergence here would give the same physical device two identity
    // signatures across protocols.
    expect(meshcoreTransportParams(type, opts)).toEqual(meshtasticTransportParams(type, opts));
  });

  it('defaults a missing host to empty string for both protocols', () => {
    expect(meshcoreTransportParams('tcp', {})).toEqual(meshtasticTransportParams('tcp', {}));
  });

  it('leaves missing ble/serial identifiers undefined for both protocols', () => {
    expect(meshcoreTransportParams('ble', {})).toEqual({ type: 'ble', peripheralId: undefined });
    expect(meshcoreTransportParams('serial', {})).toEqual({
      type: 'serial',
      portSignature: undefined,
    });
  });

  it('throws on an unsupported meshcore transport type', () => {
    expect(() => meshcoreTransportParams('carrier-pigeon' as unknown as 'tcp', {})).toThrow(
      /meshcoreTransportParams/,
    );
  });
});
