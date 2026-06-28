import type { NobleBleSessionId } from '@/shared/electron-api.types';

import { errLikeToLogString } from './errLikeToLogString';
import type { MeshProtocol } from './types';

export const BLE_RECONNECT_SCAN_TIMEOUT_MS = 30_000;

/** Noble wait-for-peripheral + scan fallback; ConnectionPanel must not use a shorter UI timeout. */
export const BLE_NOBLE_AUTO_CONNECT_MAX_MS = 30_000 + BLE_RECONNECT_SCAN_TIMEOUT_MS + 15_000;

function isLinuxPlatform(): boolean {
  return typeof window !== 'undefined' && window.electronAPI.getPlatform() === 'linux';
}

/**
 * Noble macOS/Windows: connect immediately (main process uses knownPeripherals cache),
 * then scan until the peripheral appears if connect fails, then retry connect.
 * Linux Web Bluetooth and serial/HTTP/TCP reconnect use {@link rfReconnectHelper} instead.
 */
export async function reconnectBleWithScan(
  protocol: MeshProtocol,
  peripheralId: string,
  connect: () => Promise<void>,
  opts?: { scanTimeoutMs?: number },
): Promise<void> {
  if (isLinuxPlatform()) {
    await connect();
    return;
  }

  // Fast path: main connect() resolves from Noble cache without a new discovery event.
  try {
    await connect();
    return;
  } catch (err) {
    console.debug(
      '[bleReconnectHelper] immediate connect failed — scanning ' + errLikeToLogString(err),
    );
  }

  const sessionId: NobleBleSessionId = protocol;
  const timeoutMs = opts?.scanTimeoutMs ?? BLE_RECONNECT_SCAN_TIMEOUT_MS;

  return new Promise<void>((resolve, reject) => {
    const abortController = new AbortController();
    const { signal } = abortController;
    let scanTimeout: ReturnType<typeof setTimeout> | null = null;
    let offDiscovered: (() => void) | null = null;

    const cleanup = () => {
      if (scanTimeout != null) {
        clearTimeout(scanTimeout);
        scanTimeout = null;
      }
      offDiscovered?.();
      offDiscovered = null;
      void window.electronAPI.stopNobleBleScanning(sessionId).catch((e: unknown) => {
        console.debug('[bleReconnectHelper] stopNobleBleScanning ' + errLikeToLogString(e));
      });
    };

    const finish = (fn: () => void) => {
      if (signal.aborted) return;
      abortController.abort();
      fn();
    };

    signal.addEventListener('abort', cleanup, { once: true });

    offDiscovered = window.electronAPI.onNobleBleDeviceDiscovered((device) => {
      if (signal.aborted || device.deviceId !== peripheralId) return;
      finish(() => {
        void connect().then(resolve).catch(reject);
      });
    });

    scanTimeout = setTimeout(() => {
      finish(() => {
        reject(new Error(`BLE auto-reconnect timed out after ${timeoutMs / 1000}s`));
      });
    }, timeoutMs);

    void window.electronAPI.startNobleBleScanning(sessionId).catch((err: unknown) => {
      finish(() => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  });
}
