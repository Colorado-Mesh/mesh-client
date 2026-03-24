import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@meshtastic/core', () => ({
  MeshDevice: vi.fn().mockImplementation(function MeshDevice(transport: unknown) {
    return { transport };
  }),
}));

vi.mock('./transportNobleIpc', () => ({
  TransportNobleIpc: vi.fn().mockImplementation(function TransportNobleIpc(sessionId: string) {
    return { sessionId };
  }),
}));

import { MeshDevice } from '@meshtastic/core';

import { createBleConnection } from './connection';

describe('createBleConnection retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue(undefined);
  });

  it('retries once on main-process BLE timeout errors', async () => {
    vi.mocked(window.electronAPI.connectNobleBle)
      .mockRejectedValueOnce(new Error('BLE connectAsync timed out after 30000ms'))
      .mockResolvedValueOnce(undefined);

    const device = await createBleConnection('ble-device-1', 'meshtastic');

    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.connectNobleBle).toHaveBeenNthCalledWith(
      1,
      'meshtastic',
      'ble-device-1',
    );
    expect(window.electronAPI.connectNobleBle).toHaveBeenNthCalledWith(
      2,
      'meshtastic',
      'ble-device-1',
    );
    expect(MeshDevice).toHaveBeenCalledTimes(1);
    expect(device).toBeTruthy();
  });

  it('does not retry non-timeout BLE errors', async () => {
    vi.mocked(window.electronAPI.connectNobleBle).mockRejectedValue(
      new Error('Bluetooth adapter is not available'),
    );

    await expect(createBleConnection('ble-device-2', 'meshtastic')).rejects.toThrow(
      'Bluetooth adapter is not available',
    );
    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(1);
  });
});
