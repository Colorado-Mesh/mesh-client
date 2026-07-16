// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_SETUP_ABORT_MESSAGE } from './bleConnectErrors';
import {
  BLE_SCAN_BUSY_MAX_WAIT_MS,
  BLE_SCAN_BUSY_RETRY_INTERVAL_MS,
  connectNobleBleWithScanBusyRetry,
  reconnectBleWithScan,
  startNobleBleScanningWithRetry,
  verifyNobleBleRfLink,
} from './bleReconnectHelper';

describe('verifyNobleBleRfLink', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
    window.electronAPI = {
      ...window.electronAPI,
      isNobleBleConnected: vi.fn().mockResolvedValue(true),
    };
  });

  it('returns true for non-BLE transports', async () => {
    await expect(verifyNobleBleRfLink('serial', 'meshtastic')).resolves.toBe(true);
    await expect(verifyNobleBleRfLink('tcp', 'meshcore')).resolves.toBe(true);
  });

  it('queries Noble IPC for BLE on darwin', async () => {
    await expect(verifyNobleBleRfLink('ble', 'meshcore')).resolves.toBe(true);
    expect(window.electronAPI.isNobleBleConnected).toHaveBeenCalledWith('meshcore');
  });

  it('returns true on Linux without querying Noble', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    await expect(verifyNobleBleRfLink('ble', 'meshtastic')).resolves.toBe(true);
    expect(window.electronAPI.isNobleBleConnected).not.toHaveBeenCalled();
  });

  it('returns false when Noble IPC throws', async () => {
    vi.mocked(window.electronAPI.isNobleBleConnected).mockRejectedValue(new Error('ipc down'));
    await expect(verifyNobleBleRfLink('ble', 'meshtastic')).resolves.toBe(false);
  });
});

describe('startNobleBleScanningWithRetry', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
    window.electronAPI = {
      ...window.electronAPI,
      getPlatform: vi.fn().mockReturnValue('darwin'),
      startNobleBleScanning: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it('retries when scan is busy then succeeds', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.startNobleBleScanning)
      .mockResolvedValueOnce({ ok: false, code: 'scan_busy', owner: 'reticulum' })
      .mockResolvedValueOnce({ ok: true });

    const pending = startNobleBleScanningWithRetry('meshcore');
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(window.electronAPI.startNobleBleScanning).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('fails after max wait when scan stays busy', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.startNobleBleScanning).mockResolvedValue({
      ok: false,
      code: 'scan_busy',
      owner: 'reticulum',
    });

    const pending = startNobleBleScanningWithRetry('meshcore');
    const rejection = expect(pending).rejects.toThrow(/Bluetooth scan in progress \(reticulum\)/);
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_MAX_WAIT_MS + BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    await rejection;
    vi.useRealTimers();
  });
});

describe('connectNobleBleWithScanBusyRetry', () => {
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      connectNobleBle: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it('retries when connect is rejected for reticulum scan yield then succeeds', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.connectNobleBle)
      .mockResolvedValueOnce({
        ok: false,
        error: 'Bluetooth scan in progress (reticulum)',
      })
      .mockResolvedValueOnce({ ok: true });

    const pending = connectNobleBleWithScanBusyRetry('meshtastic', 'periph-1');
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.connectNobleBle).toHaveBeenNthCalledWith(1, 'meshtastic', 'periph-1');
    vi.useRealTimers();
  });

  it('retries when another scan owner holds the mutex (not only reticulum)', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.connectNobleBle)
      .mockResolvedValueOnce({
        ok: false,
        error: 'Bluetooth scan in progress (noble)',
      })
      .mockResolvedValueOnce({ ok: true });

    const pending = connectNobleBleWithScanBusyRetry('meshcore', 'periph-2');
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('fails immediately on non-scan-busy connect errors', async () => {
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue({
      ok: false,
      error: 'Bluetooth adapter is not available',
    });

    await expect(connectNobleBleWithScanBusyRetry('meshtastic', 'periph-1')).rejects.toThrow(
      'Bluetooth adapter is not available',
    );
    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(1);
  });

  it('fails after max wait when scan yield never releases', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue({
      ok: false,
      error: 'Bluetooth scan in progress (reticulum)',
    });

    const pending = connectNobleBleWithScanBusyRetry('meshtastic', 'periph-1');
    const rejection = expect(pending).rejects.toThrow(/Bluetooth scan in progress \(reticulum\)/);
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_MAX_WAIT_MS + BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    await rejection;
    vi.useRealTimers();
  });
});

describe('reconnectBleWithScan', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
    window.electronAPI = {
      ...window.electronAPI,
      getPlatform: vi.fn().mockReturnValue('darwin'),
      startNobleBleScanning: vi.fn().mockResolvedValue({ ok: true }),
      stopNobleBleScanning: vi.fn().mockResolvedValue(undefined),
      onNobleBleDeviceDiscovered: vi.fn().mockReturnValue(() => {}),
    };
  });

  it('does not scan when immediate connect fails with MeshCore setup abort', async () => {
    const connect = vi
      .fn()
      .mockRejectedValue(new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError'));

    await expect(reconnectBleWithScan('meshcore', 'abc', connect)).rejects.toMatchObject({
      name: 'AbortError',
      message: MESHCORE_SETUP_ABORT_MESSAGE,
    });
    expect(window.electronAPI.startNobleBleScanning).not.toHaveBeenCalled();
  });

  it('does not scan when protocol runtime session is not mounted yet', async () => {
    const connect = vi
      .fn()
      .mockRejectedValue(new Error('[meshtasticSession] Meshtastic runtime is not mounted'));

    await expect(reconnectBleWithScan('meshtastic', 'abc', connect)).rejects.toThrow(
      /runtime is not mounted/,
    );
    expect(window.electronAPI.startNobleBleScanning).not.toHaveBeenCalled();
  });
});
