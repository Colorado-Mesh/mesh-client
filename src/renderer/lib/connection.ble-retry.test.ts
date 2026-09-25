import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@meshtastic/core', () => ({
  MeshDevice: vi.fn().mockImplementation(function MeshDevice(transport: unknown) {
    return { transport };
  }),
}));

vi.mock('./meshcoreDualNobleBleInit', () => ({
  notifyBlePrimaryRfLinkReady: vi.fn(),
}));

vi.mock('./transportSidecarGatt', () => ({
  TransportSidecarGatt: vi.fn().mockImplementation(function TransportSidecarGatt(
    sessionId: string,
  ) {
    return {
      sessionId,
      fromDevice: new ReadableStream<Uint8Array>(),
      toDevice: new WritableStream<Uint8Array>(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

import { MeshDevice } from '@meshtastic/core';

import { BLE_SCAN_BUSY_MAX_WAIT_MS, BLE_SCAN_BUSY_RETRY_INTERVAL_MS } from './bleReconnectHelper';
import { createBleConnection } from './connection';

describe('createBleConnection retry behavior', () => {
  beforeEach(() => {
    vi.mocked(MeshDevice).mockClear();
    vi.mocked(window.electronAPI.connectGatt).mockClear();
    vi.mocked(window.electronAPI.connectGatt).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.resetBlePairingRetryCount).mockImplementation(() => {});
  });

  it('retries once on main-process BLE timeout errors', async () => {
    vi.mocked(window.electronAPI.connectGatt)
      .mockResolvedValueOnce({ ok: false, error: 'BLE connectAsync timed out after 30000ms' })
      .mockResolvedValueOnce({ ok: true });

    const device = await createBleConnection('ble-device-1', 'meshtastic');

    expect(window.electronAPI.connectGatt).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.connectGatt).toHaveBeenNthCalledWith(1, 'meshtastic', 'ble-device-1');
    expect(window.electronAPI.connectGatt).toHaveBeenNthCalledWith(2, 'meshtastic', 'ble-device-1');
    expect(MeshDevice).toHaveBeenCalledTimes(1);
    expect(device).toBeTruthy();
  });

  it('logs createBleConnection start as a single readable line (no [object Object])', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await createBleConnection('ble-device-log', 'meshtastic');
    const startMsg = debugSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('createBleConnection start'),
    )?.[0] as string | undefined;
    expect(startMsg).toBeDefined();
    expect(startMsg).not.toContain('[object Object]');
    expect(startMsg).toContain('peripheralId=ble-device-log');
    expect(startMsg).toContain('sessionId=meshtastic');
    debugSpy.mockRestore();
  });

  it('does not retry non-timeout BLE errors', async () => {
    vi.mocked(window.electronAPI.connectGatt).mockResolvedValue({
      ok: false,
      error: 'Bluetooth adapter is not available',
    });

    await expect(createBleConnection('ble-device-2', 'meshtastic')).rejects.toThrow(
      'Bluetooth adapter is not available',
    );
    expect(window.electronAPI.connectGatt).toHaveBeenCalledTimes(1);
  });

  it('waits out reticulum scan lease then connects (dual-radio primary race)', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.connectGatt)
      .mockResolvedValueOnce({
        ok: false,
        error: 'Bluetooth scan in progress (reticulum)',
      })
      .mockResolvedValueOnce({ ok: true });

    const pending = createBleConnection('ble-device-yield', 'meshtastic');
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    const device = await pending;

    expect(window.electronAPI.connectGatt).toHaveBeenCalledTimes(2);
    expect(device).toBeTruthy();
    vi.useRealTimers();
  });

  it('fails createBleConnection after scan-busy max wait without a second timeout attempt', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.connectGatt).mockResolvedValue({
      ok: false,
      error: 'Bluetooth scan in progress (reticulum)',
    });

    const pending = createBleConnection('ble-device-stuck-yield', 'meshtastic');
    const rejection = expect(pending).rejects.toThrow(/Bluetooth scan in progress \(reticulum\)/);
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_MAX_WAIT_MS + BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    await rejection;

    // Scan-busy wait is one logical connect attempt — do not burn BLE_CONNECT_MAX_ATTEMPTS.
    expect(vi.mocked(window.electronAPI.connectGatt).mock.calls.length).toBeGreaterThan(1);
    vi.useRealTimers();
  });

  it('does not wait on peripheral conflict errors', async () => {
    vi.mocked(window.electronAPI.connectGatt).mockResolvedValue({
      ok: false,
      error: 'BLE peripheral aa:bb:cc:dd:ee:ff already claimed by gatt:meshcore',
    });

    await expect(createBleConnection('conflict-dev', 'meshtastic')).rejects.toThrow(
      /already claimed/,
    );
    expect(window.electronAPI.connectGatt).toHaveBeenCalledTimes(1);
  });

  it('requires a peripheral id on all platforms (sidecar GATT)', async () => {
    await expect(createBleConnection(undefined, 'meshtastic')).rejects.toThrow(
      'BLE peripheral ID required',
    );
    expect(window.electronAPI.connectGatt).not.toHaveBeenCalled();
  });
});
