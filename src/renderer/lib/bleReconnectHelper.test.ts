// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BLE_RECONNECT_SCAN_TIMEOUT_MS, reconnectBleWithScan } from './bleReconnectHelper';

describe('reconnectBleWithScan', () => {
  let discoveredCb: ((device: { deviceId: string; name: string }) => void) | null = null;

  beforeEach(() => {
    discoveredCb = null;
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
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
    vi.useRealTimers();
  });

  it('connects immediately on Linux without Noble scan', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
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

  it('ignores discovery events for other device ids until target appears', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('peripheral not in cache'))
      .mockResolvedValueOnce(undefined);
    const promise = reconnectBleWithScan('meshtastic', 'ble-target', connect);
    await vi.waitFor(() => {
      expect(window.electronAPI.startNobleBleScanning).toHaveBeenCalled();
    });
    discoveredCb?.({ deviceId: 'ble-other', name: 'Other' });
    expect(connect).toHaveBeenCalledTimes(1);
    discoveredCb?.({ deviceId: 'ble-target', name: 'Radio' });
    await promise;
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('rejects when connect fails after discovery', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('peripheral not in cache'))
      .mockRejectedValueOnce(new Error('connect failed after discovery'));
    const promise = reconnectBleWithScan('meshtastic', 'ble-1', connect);
    await vi.waitFor(() => {
      expect(window.electronAPI.startNobleBleScanning).toHaveBeenCalled();
    });
    discoveredCb?.({ deviceId: 'ble-1', name: 'Radio' });
    await expect(promise).rejects.toThrow('connect failed after discovery');
    expect(window.electronAPI.stopNobleBleScanning).toHaveBeenCalledWith('meshtastic');
  });

  it('ignores duplicate discovery after first match settles', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('peripheral not in cache'))
      .mockResolvedValueOnce(undefined);
    const promise = reconnectBleWithScan('meshtastic', 'ble-1', connect);
    await vi.waitFor(() => {
      expect(window.electronAPI.startNobleBleScanning).toHaveBeenCalled();
    });
    discoveredCb?.({ deviceId: 'ble-1', name: 'Radio' });
    discoveredCb?.({ deviceId: 'ble-1', name: 'Radio' });
    await promise;
    expect(connect).toHaveBeenCalledTimes(2);
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

  it('evaluates Linux vs Noble at call time (not module import)', async () => {
    vi.resetModules();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    const { reconnectBleWithScan: reconnectAtCallTime } = await import('./bleReconnectHelper');
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('peripheral not in cache'))
      .mockResolvedValueOnce(undefined);
    const promise = reconnectAtCallTime('meshtastic', 'ble-1', connect);
    await vi.waitFor(() => {
      expect(window.electronAPI.startNobleBleScanning).toHaveBeenCalledWith('meshtastic');
    });
    discoveredCb?.({ deviceId: 'ble-1', name: 'Radio' });
    await promise;
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
