// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BLE_RECONNECT_SCAN_TIMEOUT_MS, reconnectBleWithScan } from './bleReconnectHelper';

describe('reconnectBleWithScan', () => {
  const originalUa = navigator.userAgent;
  let discoveredCb: ((device: { deviceId: string; name: string }) => void) | null = null;

  beforeEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Macintosh',
      configurable: true,
    });
    discoveredCb = null;
    vi.useFakeTimers();
    window.electronAPI.startNobleBleScanning = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.stopNobleBleScanning = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.onNobleBleDeviceDiscovered = vi.fn((cb) => {
      discoveredCb = cb;
      return () => {
        discoveredCb = null;
      };
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUa, configurable: true });
    vi.useRealTimers();
  });

  it('connects immediately on Linux without Noble scan', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Linux', configurable: true });
    const connect = vi.fn().mockResolvedValue(undefined);
    await reconnectBleWithScan('meshtastic', 'ble-1', connect);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.startNobleBleScanning).not.toHaveBeenCalled();
  });

  it('uses fast path when immediate connect succeeds (Noble cache hit)', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const promise = reconnectBleWithScan('meshtastic', 'ble-1', connect);
    await promise;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.startNobleBleScanning).not.toHaveBeenCalled();
  });

  it('scans and connects when immediate connect fails', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('peripheral not in cache'))
      .mockResolvedValueOnce(undefined);
    const promise = reconnectBleWithScan('meshtastic', 'ble-1', connect);
    await vi.waitFor(() => {
      expect(window.electronAPI.startNobleBleScanning).toHaveBeenCalledWith('meshtastic');
    });
    discoveredCb?.({ deviceId: 'ble-1', name: 'Radio' });
    await promise;
    expect(connect).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.stopNobleBleScanning).toHaveBeenCalledWith('meshtastic');
  });

  it('rejects after scan timeout when peripheral never appears', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('peripheral not in cache'));
    const promise = reconnectBleWithScan('meshtastic', 'ble-1', connect, {
      scanTimeoutMs: BLE_RECONNECT_SCAN_TIMEOUT_MS,
    });
    await vi.waitFor(() => {
      expect(window.electronAPI.startNobleBleScanning).toHaveBeenCalled();
    });
    const rejection = expect(promise).rejects.toThrow(/timed out after 30s/);
    await vi.advanceTimersByTimeAsync(BLE_RECONNECT_SCAN_TIMEOUT_MS + 100);
    await rejection;
    expect(window.electronAPI.stopNobleBleScanning).toHaveBeenCalledWith('meshtastic');
  });

  it('propagates scan start failure and stops scanning', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('peripheral not in cache'));
    vi.mocked(window.electronAPI.startNobleBleScanning).mockRejectedValue(new Error('adapter off'));
    await expect(reconnectBleWithScan('meshcore', 'ble-2', connect)).rejects.toThrow('adapter off');
    expect(window.electronAPI.stopNobleBleScanning).toHaveBeenCalledWith('meshcore');
  });
});
