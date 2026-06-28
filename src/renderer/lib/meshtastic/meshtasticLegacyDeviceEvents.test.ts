// @vitest-environment jsdom
import type { MeshDevice } from '@meshtastic/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pushMeshtasticTransportSideEffectUnsubs } from './meshtasticLegacyDeviceEvents';
import { attachMeshtasticTransportLossWatch } from './meshtasticTransportLossDetection';

vi.mock('./meshtasticTransportLossDetection', () => ({
  attachMeshtasticTransportLossWatch: vi.fn(() => () => {}),
}));

describe('pushMeshtasticTransportSideEffectUnsubs', () => {
  const onTransportLost = vi.fn();
  let unsubs: (() => void)[];

  beforeEach(() => {
    vi.clearAllMocks();
    unsubs = [];
    window.electronAPI.onNobleBleDisconnected = vi.fn(() => () => {});
  });

  function mockDevice(): MeshDevice {
    return {
      setHeartbeatInterval: vi.fn(),
    } as unknown as MeshDevice;
  }

  it('attaches serialized transport and heartbeat for BLE', () => {
    const device = mockDevice();
    pushMeshtasticTransportSideEffectUnsubs(
      device,
      'ble',
      (unsub) => unsubs.push(unsub),
      onTransportLost,
    );

    expect(window.electronAPI.onNobleBleDisconnected).not.toHaveBeenCalled();
    expect(attachMeshtasticTransportLossWatch).toHaveBeenCalledWith(device, 'ble', onTransportLost);
    expect(device.setHeartbeatInterval).toHaveBeenCalledWith(60_000);
    expect(unsubs).toHaveLength(1);
  });

  it('attaches serialized transport and heartbeat for serial', () => {
    const device = mockDevice();
    pushMeshtasticTransportSideEffectUnsubs(
      device,
      'serial',
      (unsub) => unsubs.push(unsub),
      onTransportLost,
    );

    expect(window.electronAPI.onNobleBleDisconnected).not.toHaveBeenCalled();
    expect(attachMeshtasticTransportLossWatch).toHaveBeenCalledWith(
      device,
      'serial',
      onTransportLost,
    );
    expect(device.setHeartbeatInterval).toHaveBeenCalledWith(60_000);
    expect(unsubs).toHaveLength(1);
  });

  it('skips transport loss watch and heartbeat for HTTP', () => {
    const device = mockDevice();
    pushMeshtasticTransportSideEffectUnsubs(
      device,
      'http',
      (unsub) => unsubs.push(unsub),
      onTransportLost,
    );

    expect(window.electronAPI.onNobleBleDisconnected).not.toHaveBeenCalled();
    expect(attachMeshtasticTransportLossWatch).not.toHaveBeenCalled();
    expect(device.setHeartbeatInterval).not.toHaveBeenCalled();
    expect(unsubs).toHaveLength(0);
  });
});
