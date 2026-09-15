// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_SETUP_ABORT_MESSAGE } from './bleConnectErrors';
import {
  BLE_SCAN_BUSY_MAX_WAIT_MS,
  BLE_SCAN_BUSY_RETRY_INTERVAL_MS,
  connectGattWithScanBusyRetry,
  raceWithDeadline,
  reconnectBleWithScan,
  startGattScanningWithRetry,
  verifyGattRfLink,
} from './bleReconnectHelper';

describe('raceWithDeadline', () => {
  it('resolves when work finishes before the budget', async () => {
    await expect(raceWithDeadline(Promise.resolve(42), 1_000, 'timed out')).resolves.toBe(42);
  });

  it('rejects when the budget elapses first', async () => {
    vi.useFakeTimers();
    const pending = raceWithDeadline(
      new Promise<number>(() => {
        /* never settles */
      }),
      90_000,
      'BLE reconnect attempt timed out',
    );
    const rejection = expect(pending).rejects.toThrow(/BLE reconnect attempt timed out/);
    await vi.advanceTimersByTimeAsync(90_000);
    await rejection;
    vi.useRealTimers();
  });
});

describe('verifyGattRfLink', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
    window.electronAPI = {
      ...window.electronAPI,
      isGattConnected: vi.fn().mockResolvedValue(true),
    };
  });

  it('returns true for non-BLE transports', async () => {
    await expect(verifyGattRfLink('serial', 'meshtastic')).resolves.toBe(true);
    await expect(verifyGattRfLink('tcp', 'meshcore')).resolves.toBe(true);
  });

  it('queries GATT IPC for BLE on darwin', async () => {
    await expect(verifyGattRfLink('ble', 'meshcore')).resolves.toBe(true);
    expect(window.electronAPI.isGattConnected).toHaveBeenCalledWith('meshcore');
  });

  it('queries GATT IPC for BLE on Linux', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    await expect(verifyGattRfLink('ble', 'meshtastic')).resolves.toBe(true);
    expect(window.electronAPI.isGattConnected).toHaveBeenCalledWith('meshtastic');
  });

  it('returns false when GATT IPC throws', async () => {
    vi.mocked(window.electronAPI.isGattConnected).mockRejectedValue(new Error('ipc down'));
    await expect(verifyGattRfLink('ble', 'meshtastic')).resolves.toBe(false);
  });
});

describe('startGattScanningWithRetry', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
    window.electronAPI = {
      ...window.electronAPI,
      getPlatform: vi.fn().mockReturnValue('darwin'),
      startGattScanning: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it('retries when scan is busy then succeeds', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.startGattScanning)
      .mockResolvedValueOnce({ ok: false, code: 'scan_busy', owner: 'reticulum' })
      .mockResolvedValueOnce({ ok: true });

    const pending = startGattScanningWithRetry('meshcore');
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(window.electronAPI.startGattScanning).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('fails after max wait when scan stays busy', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.startGattScanning).mockResolvedValue({
      ok: false,
      code: 'scan_busy',
      owner: 'reticulum',
    });

    const pending = startGattScanningWithRetry('meshcore');
    const rejection = expect(pending).rejects.toThrow(/Bluetooth scan in progress \(reticulum\)/);
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_MAX_WAIT_MS + BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    await rejection;
    vi.useRealTimers();
  });
});

describe('connectGattWithScanBusyRetry', () => {
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      connectGatt: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it('retries when connect is rejected for reticulum scan yield then succeeds', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.connectGatt)
      .mockResolvedValueOnce({
        ok: false,
        error: 'Bluetooth scan in progress (reticulum)',
      })
      .mockResolvedValueOnce({ ok: true });

    const pending = connectGattWithScanBusyRetry('meshtastic', 'periph-1');
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(window.electronAPI.connectGatt).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.connectGatt).toHaveBeenNthCalledWith(1, 'meshtastic', 'periph-1');
    vi.useRealTimers();
  });

  it('retries when another scan owner holds the mutex (not only reticulum)', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.connectGatt)
      .mockResolvedValueOnce({
        ok: false,
        error: 'Bluetooth scan in progress (noble)',
      })
      .mockResolvedValueOnce({ ok: true });

    const pending = connectGattWithScanBusyRetry('meshcore', 'periph-2');
    await vi.advanceTimersByTimeAsync(BLE_SCAN_BUSY_RETRY_INTERVAL_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(window.electronAPI.connectGatt).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('fails immediately on non-scan-busy connect errors', async () => {
    vi.mocked(window.electronAPI.connectGatt).mockResolvedValue({
      ok: false,
      error: 'Bluetooth adapter is not available',
    });

    await expect(connectGattWithScanBusyRetry('meshtastic', 'periph-1')).rejects.toThrow(
      'Bluetooth adapter is not available',
    );
    expect(window.electronAPI.connectGatt).toHaveBeenCalledTimes(1);
  });

  it('fails after max wait when scan yield never releases', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.connectGatt).mockResolvedValue({
      ok: false,
      error: 'Bluetooth scan in progress (reticulum)',
    });

    const pending = connectGattWithScanBusyRetry('meshtastic', 'periph-1');
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
      startGattScanning: vi.fn().mockResolvedValue({ ok: true }),
      stopGattScanning: vi.fn().mockResolvedValue(undefined),
      onGattDeviceDiscovered: vi.fn().mockReturnValue(() => {}),
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
    expect(window.electronAPI.startGattScanning).not.toHaveBeenCalled();
  });

  it('does not scan when protocol runtime session is not mounted yet', async () => {
    const connect = vi
      .fn()
      .mockRejectedValue(new Error('[meshtasticSession] Meshtastic runtime is not mounted'));

    await expect(reconnectBleWithScan('meshtastic', 'abc', connect)).rejects.toThrow(
      /runtime is not mounted/,
    );
    expect(window.electronAPI.startGattScanning).not.toHaveBeenCalled();
  });

  it('does not scan after missing-services failures', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('Could not find all requested services'));

    await expect(reconnectBleWithScan('meshcore', 'bad-device', connect)).rejects.toThrow(
      /Could not find all requested services/,
    );
    expect(window.electronAPI.startGattScanning).not.toHaveBeenCalled();
  });

  it('matches discovery by hex-normalized UUID / MAC aliases', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('not found — scan first'))
      .mockResolvedValueOnce(undefined);
    const discovered = vi.fn();
    vi.mocked(window.electronAPI.onGattDeviceDiscovered).mockImplementation((cb) => {
      discovered.mockImplementation(cb);
      return () => {};
    });

    const pending = reconnectBleWithScan('meshcore', 'ff92959fd78be6f009376829a4d6efdc', connect, {
      matchIds: ['aa:bb:cc:dd:ee:ff'],
    });
    await Promise.resolve();
    discovered({
      deviceId: 'AA:BB:CC:DD:EE:FF',
      deviceName: 'MeshCore',
      address: 'AA:BB:CC:DD:EE:FF',
    });
    await expect(pending).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenNthCalledWith(1);
    expect(connect).toHaveBeenNthCalledWith(2, 'AA:BB:CC:DD:EE:FF');
    expect(window.electronAPI.startGattScanning).toHaveBeenCalled();
  });
});
