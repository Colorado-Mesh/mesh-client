import type { GattBleSessionId, GattBleStartScanResult } from '@/shared/electron-api.types';
import { bleIdsMatch } from '@/shared/normalizeBleMac';

import {
  isMeshcoreMissingServicesErrorMessage,
  isMeshcoreSetupAbortError,
  isReticulumSidecarResolveErrorMessage,
} from './bleConnectErrors';
import { errLikeToLogString } from './errLikeToLogString';
import { isBleScanBusyErrorMessage } from './reticulum/reticulumBleAdapterLease';
import type { MeshProtocol } from './types';

const BLE_RECONNECT_SCAN_TIMEOUT_MS = 60_000;

/** Poll interval while waiting for Reticulum/external BLE scan to release the adapter. */
export const BLE_SCAN_BUSY_RETRY_INTERVAL_MS = 250;

/**
 * Max wait for scan mutex before failing GATT reconnect / connect retry.
 * Keep >= Reticulum BLE RNode connect grace (30s in reticulumLocalInterfaceRefresh)
 * so Meshtastic primary auto-connect can wait out a start yield.
 * 60s also covers longer multi-protocol scan-mutex holds under spotty BLE.
 */
export const BLE_SCAN_BUSY_MAX_WAIT_MS = 60_000;

/** GATT wait-for-peripheral + scan fallback; ConnectionPanel must not use a shorter UI timeout. */
function isGattStartScanBusyResult(
  result: GattBleStartScanResult,
): result is Extract<GattBleStartScanResult, { ok: false; code: 'scan_busy' }> {
  return !result.ok && result.code === 'scan_busy';
}

function gattStartScanBusyMessage(owner: string): string {
  return `Bluetooth scan in progress (${owner})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Start sidecar GATT scan; retry when Reticulum or another owner holds the scan mutex. */
export async function startGattScanningWithRetry(
  sessionId: GattBleSessionId,
  opts?: { maxWaitMs?: number; retryIntervalMs?: number; timeoutSecs?: number },
): Promise<void> {
  const maxWaitMs = opts?.maxWaitMs ?? BLE_SCAN_BUSY_MAX_WAIT_MS;
  const retryIntervalMs = opts?.retryIntervalMs ?? BLE_SCAN_BUSY_RETRY_INTERVAL_MS;
  const deadline = Date.now() + maxWaitMs;
  let lastOwner = 'unknown';
  const scanOpts = opts?.timeoutSecs != null ? { timeoutSecs: opts.timeoutSecs } : undefined;

  while (Date.now() < deadline) {
    const result = scanOpts
      ? await window.electronAPI.startGattScanning(sessionId, scanOpts)
      : await window.electronAPI.startGattScanning(sessionId);
    if (result.ok) {
      return;
    }
    if (isGattStartScanBusyResult(result)) {
      lastOwner = result.owner;
      console.debug(
        `[bleReconnectHelper] scan busy (owner=${result.owner}) — retrying in ${retryIntervalMs}ms`,
      );
      await sleep(retryIntervalMs);
      continue;
    }
    if ('error' in result) {
      throw new Error(`${result.code}: ${result.error}`);
    }
    throw new Error('GATT BLE scan failed');
  }

  throw new Error(gattStartScanBusyMessage(lastOwner));
}

/**
 * Sidecar GATT connect; retry when Reticulum (or another owner) holds the scan yield.
 * Meshtastic dual-radio auto-connect is primary and often races a short RNode yield —
 * hard-failing here left MeshCore able to connect after release while Meshtastic stayed down.
 */
export async function connectGattWithScanBusyRetry(
  sessionId: GattBleSessionId,
  peripheralId: string,
  opts?: { maxWaitMs?: number; retryIntervalMs?: number; shouldAbort?: () => boolean },
): Promise<void> {
  const maxWaitMs = opts?.maxWaitMs ?? BLE_SCAN_BUSY_MAX_WAIT_MS;
  const retryIntervalMs = opts?.retryIntervalMs ?? BLE_SCAN_BUSY_RETRY_INTERVAL_MS;
  const deadline = Date.now() + maxWaitMs;
  let lastError = 'BLE connect failed';

  while (Date.now() < deadline) {
    if (opts?.shouldAbort?.()) {
      throw new Error('RNode bond recovery holds the Bluetooth adapter');
    }
    const result = await window.electronAPI.connectGatt(sessionId, peripheralId);
    if (result.ok) {
      return;
    }
    const message = result.error || 'BLE connect failed';
    const code = 'code' in result && typeof result.code === 'string' ? result.code : undefined;
    lastError = code && code !== 'scan_busy' ? `${code}: ${message}` : message;
    if (code === 'rnode_bond_recovery' || /RNode bond recovery/i.test(message)) {
      throw new Error(lastError);
    }
    if (!isBleScanBusyErrorMessage(message) && code !== 'scan_busy') {
      throw new Error(lastError);
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

/** Verify sidecar GATT is still connected after configure. */
export async function verifyGattRfLink(
  rfType: 'ble' | 'serial' | 'tcp' | 'http',
  sessionId: GattBleSessionId,
): Promise<boolean> {
  if (rfType !== 'ble') return true;
  try {
    return await window.electronAPI.isGattConnected(sessionId);
  } catch (e: unknown) {
    console.debug('[renderer/lib/bleReconnectHelper] catch:', e);

    return false;
  }
}

function shouldScanAfterConnectFailure(message: string): boolean {
  if (isMeshcoreMissingServicesErrorMessage(message)) return false;
  if (isReticulumSidecarResolveErrorMessage(message)) return false;
  if (/runtime is not mounted/i.test(message)) return false;
  // Sidecar / adapter needs discovery before connect (Noble UUID cold start).
  if (/scan first|not found|unknown peripheral|no such device/i.test(message)) return true;
  // Transient connect failures may clear after a fresh scan.
  if (/connect_timeout|timed out|unreachable/i.test(message)) return true;
  return false;
}

/** Short discovery pass before reconnect so CoreBluetooth scan RSSI seeds the host meter. */
const BLE_RECONNECT_DISCOVERY_TIMEOUT_SECS = 4;

/**
 * Discover then connect. CoreBluetooth only exposes host RSSI in advertisements — connecting
 * without a prior scan leaves the Connection panel signal meter empty forever.
 * If discovery misses, fall back to connect with the stored id; if that fails with a
 * scan-needed error, run a longer discovery retry. Serial/HTTP/TCP reconnect use
 * {@link rfReconnectHelper} instead.
 *
 * @param matchIds — optional aliases (e.g. stored Noble UUID + bleMac) matched against
 *   discovered `deviceId` / `address` via hex-normalized equality.
 * @param connect — optional `resolvedPeripheralId` is the discovered id when scan matched
 *   via an alias (MAC / alternate UUID); omit to use the original stored id.
 */
export async function reconnectBleWithScan(
  protocol: MeshProtocol,
  peripheralId: string,
  connect: (resolvedPeripheralId?: string) => Promise<void>,
  opts?: {
    scanTimeoutMs?: number;
    scanBusyMaxWaitMs?: number;
    matchIds?: string[];
    discoveryTimeoutSecs?: number;
  },
): Promise<void> {
  const sessionId: GattBleSessionId = protocol;
  const timeoutMs = opts?.scanTimeoutMs ?? BLE_RECONNECT_SCAN_TIMEOUT_MS;
  const scanBusyMaxWaitMs = opts?.scanBusyMaxWaitMs ?? BLE_SCAN_BUSY_MAX_WAIT_MS;
  const discoveryTimeoutSecs = opts?.discoveryTimeoutSecs ?? BLE_RECONNECT_DISCOVERY_TIMEOUT_SECS;
  const wantedIds = [peripheralId, ...(opts?.matchIds ?? [])].filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0,
  );

  const deviceMatches = (device: { deviceId: string; address?: string | null }): boolean => {
    const candidates = [device.deviceId, device.address ?? ''];
    return wantedIds.some((want) => candidates.some((c) => c && bleIdsMatch(want, c)));
  };

  let resolvedFromScan: string | undefined;
  {
    let offDiscovered: (() => void) | null = null;
    try {
      offDiscovered = window.electronAPI.onGattDeviceDiscovered((device) => {
        if (!deviceMatches(device)) return;
        resolvedFromScan = device.deviceId.trim() || peripheralId;
      });
      await startGattScanningWithRetry(sessionId, {
        maxWaitMs: scanBusyMaxWaitMs,
        timeoutSecs: discoveryTimeoutSecs,
      });
    } catch (err) {
      console.debug(
        '[bleReconnectHelper] discovery-first scan failed — connecting with stored id ' +
          errLikeToLogString(err),
      );
    } finally {
      offDiscovered?.();
      void window.electronAPI.stopGattScanning(sessionId).catch((e: unknown) => {
        console.debug('[bleReconnectHelper] stopGattScanning ' + errLikeToLogString(e));
      });
    }
  }

  try {
    await connect(resolvedFromScan);
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
    if (!shouldScanAfterConnectFailure(message)) {
      throw err instanceof Error ? err : new Error(message);
    }
    console.debug('[bleReconnectHelper] connect failed after discovery — scanning ' + message);
  }

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
      void window.electronAPI.stopGattScanning(sessionId).catch((e: unknown) => {
        console.debug('[bleReconnectHelper] stopGattScanning ' + errLikeToLogString(e));
      });
    };

    const finish = (fn: () => void) => {
      if (signal.aborted) return;
      abortController.abort();
      fn();
    };

    signal.addEventListener('abort', cleanup, { once: true });

    offDiscovered = window.electronAPI.onGattDeviceDiscovered((device) => {
      if (signal.aborted || !deviceMatches(device)) return;
      const resolvedId = device.deviceId.trim() || peripheralId;
      finish(() => {
        void connect(resolvedId).then(resolve).catch(reject);
      });
    });

    const remainingDiscoveryMs = Math.max(0, timeoutMs - (Date.now() - scanStartedAt));
    scanTimeout = setTimeout(() => {
      finish(() => {
        reject(new Error(`BLE auto-reconnect timed out after ${timeoutMs / 1000}s`));
      });
    }, remainingDiscoveryMs);

    void startGattScanningWithRetry(sessionId, { maxWaitMs: scanBusyMaxWaitMs }).catch(
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
