import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  let userAgentSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    userAgentSpy?.mockRestore();
    userAgentSpy = null;
  });

  it('retries once on main-process BLE timeout errors', async () => {
    vi.mocked(window.electronAPI.connectNobleBle)
      .mockResolvedValueOnce({ ok: false, error: 'BLE connectAsync timed out after 30000ms' })
      .mockResolvedValueOnce({ ok: true });

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
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue({
      ok: false,
      error: 'Bluetooth adapter is not available',
    });

    await expect(createBleConnection('ble-device-2', 'meshtastic')).rejects.toThrow(
      'Bluetooth adapter is not available',
    );
    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(1);
  });
});
