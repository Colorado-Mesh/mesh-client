import type { NobleBleSessionId } from '@/shared/electron-api.types';

import { errLikeToLogString } from './errLikeToLogString';
import type { MeshProtocol } from './types';

export const BLE_RECONNECT_SCAN_TIMEOUT_MS = 30_000;

const isLinux =
  typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux');

/**
 * Noble macOS/Windows: scan until the known peripheral appears, then invoke connect.
 * Linux Web Bluetooth and serial/HTTP/TCP reconnect use {@link rfReconnectHelper} instead.
 */
export async function reconnectBleWithScan(
  protocol: MeshProtocol,
  peripheralId: string,
  connect: () => Promise<void>,
  opts?: { scanTimeoutMs?: number },
): Promise<void> {
  if (isLinux) {
    await connect();
    return;
  }

  const sessionId: NobleBleSessionId = protocol;
  const timeoutMs = opts?.scanTimeoutMs ?? BLE_RECONNECT_SCAN_TIMEOUT_MS;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let scanTimeout: ReturnType<typeof setTimeout> | null = null;
    let offDiscovered: (() => void) | null = null;

    const cleanup = () => {
      if (scanTimeout != null) clearTimeout(scanTimeout);
      offDiscovered?.();
      offDiscovered = null;
      void window.electronAPI.stopNobleBleScanning(sessionId).catch((e: unknown) => {
        console.debug('[bleReconnectHelper] stopNobleBleScanning ' + errLikeToLogString(e));
      });
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    offDiscovered = window.electronAPI.onNobleBleDeviceDiscovered((device) => {
      if (device.deviceId !== peripheralId) return;
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
