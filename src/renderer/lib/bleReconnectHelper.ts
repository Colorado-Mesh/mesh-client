import type { NobleBleSessionId, NobleBleStartScanResult } from '@/shared/electron-api.types';

import { isMeshcoreSetupAbortError } from './bleConnectErrors';
import { errLikeToLogString } from './errLikeToLogString';
import { isBleScanBusyErrorMessage } from './reticulum/reticulumBleAdapterLease';
import type { MeshProtocol } from './types';

export const BLE_RECONNECT_SCAN_TIMEOUT_MS = 60_000;

/** Poll interval while waiting for Reticulum/external BLE scan to release the adapter. */
export const BLE_SCAN_BUSY_RETRY_INTERVAL_MS = 250;

/**
 * Max wait for scan mutex before failing Noble reconnect / connect retry.
 * Keep >= Reticulum BLE RNode connect grace (30s in reticulumLocalInterfaceRefresh)
 * so Meshtastic primary auto-connect can wait out a start yield.
 * 60s also covers longer multi-protocol scan-mutex holds under spotty BLE.
 */
export const BLE_SCAN_BUSY_MAX_WAIT_MS = 60_000;

/** Noble wait-for-peripheral + scan fallback; ConnectionPanel must not use a shorter UI timeout. */
export const BLE_NOBLE_AUTO_CONNECT_MAX_MS = 30_000 + BLE_RECONNECT_SCAN_TIMEOUT_MS + 15_000;

function isLinuxPlatform(): boolean {
  return typeof window !== 'undefined' && window.electronAPI.getPlatform() === 'linux';
}

function isLinuxWebBluetoothPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux');
}

function isNobleBleStartScanBusyResult(
  result: NobleBleStartScanResult,
): result is Extract<NobleBleStartScanResult, { ok: false; code: 'scan_busy' }> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  return !result.ok && result.code === 'scan_busy';
}

function nobleBleStartScanBusyMessage(owner: string): string {
  return `Bluetooth scan in progress (${owner})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Start Noble scan; retry when Reticulum or another owner holds the scan mutex. */
export async function startNobleBleScanningWithRetry(
  sessionId: NobleBleSessionId,
  opts?: { maxWaitMs?: number; retryIntervalMs?: number },
): Promise<void> {
  const maxWaitMs = opts?.maxWaitMs ?? BLE_SCAN_BUSY_MAX_WAIT_MS;
  const retryIntervalMs = opts?.retryIntervalMs ?? BLE_SCAN_BUSY_RETRY_INTERVAL_MS;
  const deadline = Date.now() + maxWaitMs;
  let lastOwner = 'unknown';

  while (Date.now() < deadline) {
    const result = await window.electronAPI.startNobleBleScanning(sessionId);
    if (result.ok) {
      return;
    }
    if (isNobleBleStartScanBusyResult(result)) {
      lastOwner = result.owner;
      console.debug(
        `[bleReconnectHelper] scan busy (owner=${result.owner}) — retrying in ${retryIntervalMs}ms`,
      );
      await sleep(retryIntervalMs);
      continue;
    }
    throw new Error('Noble BLE scan failed');
  }

  throw new Error(nobleBleStartScanBusyMessage(lastOwner));
}

/**
 * Noble GATT connect; retry when Reticulum (or another owner) holds the scan yield.
 * Meshtastic dual-Noble auto-connect is primary and often races a short RNode yield —
 * hard-failing here left MeshCore able to connect after release while Meshtastic stayed down.
 */
export async function connectNobleBleWithScanBusyRetry(
  sessionId: NobleBleSessionId,
  peripheralId: string,
  opts?: { maxWaitMs?: number; retryIntervalMs?: number },
): Promise<void> {
  const maxWaitMs = opts?.maxWaitMs ?? BLE_SCAN_BUSY_MAX_WAIT_MS;
  const retryIntervalMs = opts?.retryIntervalMs ?? BLE_SCAN_BUSY_RETRY_INTERVAL_MS;
  const deadline = Date.now() + maxWaitMs;
  let lastError = 'BLE connect failed';

  while (Date.now() < deadline) {
    const result = await window.electronAPI.connectNobleBle(sessionId, peripheralId);
    if (result.ok) {
      return;
    }
    const message = result.error || 'BLE connect failed';
    lastError = message;
    if (!isBleScanBusyErrorMessage(message)) {
      throw new Error(message);
    }
    console.debug(
      `[bleReconnectHelper] connect scan busy — retrying in ${retryIntervalMs}ms (${message})`,
    );
    await sleep(retryIntervalMs);
  }

  throw new Error(lastError);
}

/**
 * Race `work` against a deadline. Does not cancel `work`; callers must ignore late success
 * (generation / attemptActive guards) and tear down any transport opened after the race loses.
 */
export async function raceWithDeadline<T>(
  work: Promise<T>,
  budgetMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, budgetMs);
  });
  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Verify Noble BLE GATT is still connected after configure (macOS/Windows). */
export async function verifyNobleBleRfLink(
  rfType: 'ble' | 'serial' | 'tcp' | 'http',
  sessionId: NobleBleSessionId,
): Promise<boolean> {
  if (rfType !== 'ble') return true;
  if (isLinuxWebBluetoothPlatform()) return true;
  try {
    return await window.electronAPI.isNobleBleConnected(sessionId);
  } catch {
    // catch-no-log-ok Noble IPC may fail during teardown; treat as dead link
    return false;
  }
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
  opts?: { scanTimeoutMs?: number; scanBusyMaxWaitMs?: number },
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
    // AbortError (setup cancel / RF auto-connect cancel) must not fall through to scan.
    if (
      isMeshcoreSetupAbortError(err) ||
      (err instanceof DOMException && err.name === 'AbortError')
    ) {
      throw err;
    }
    const message = errLikeToLogString(err);
    // Session not registered yet — scanning cannot help and steals the BLE mutex from Reticulum.
    if (message.includes('runtime is not mounted')) {
      throw err instanceof Error ? err : new Error(message);
    }
    console.debug('[bleReconnectHelper] immediate connect failed — scanning ' + message);
  }

  const sessionId: NobleBleSessionId = protocol;
  const timeoutMs = opts?.scanTimeoutMs ?? BLE_RECONNECT_SCAN_TIMEOUT_MS;
  const scanBusyMaxWaitMs = opts?.scanBusyMaxWaitMs ?? BLE_SCAN_BUSY_MAX_WAIT_MS;
  const scanStartedAt = Date.now();

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

    const remainingDiscoveryMs = Math.max(0, timeoutMs - (Date.now() - scanStartedAt));
    scanTimeout = setTimeout(() => {
      finish(() => {
        reject(new Error(`BLE auto-reconnect timed out after ${timeoutMs / 1000}s`));
      });
    }, remainingDiscoveryMs);

    void startNobleBleScanningWithRetry(sessionId, { maxWaitMs: scanBusyMaxWaitMs }).catch(
      (err: unknown) => {
        finish(() => {
          const message = err instanceof Error ? err.message : String(err);
          if (isBleScanBusyErrorMessage(message)) {
            reject(new Error(message));
            return;
          }
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      },
    );
  });
}
