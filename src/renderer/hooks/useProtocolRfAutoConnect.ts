import { useEffect, useRef } from 'react';

import { reconnectBleWithScan } from '@/renderer/lib/bleReconnectHelper';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  clearStoredBleSelection,
  type LastConnection,
  loadLastBleDeviceId,
  loadLastConnection,
  saveLastConnection,
} from '@/renderer/lib/lastConnectionStorage';
import {
  awaitNobleBlePrimaryAutoConnectSettled,
  awaitNobleBleProtocolSettle,
  dualNobleBleBothRadiosConfigured,
  getNobleBleDualRadioPrimaryProtocol,
  isNobleBleDualRadioSecondary,
  isRendererNobleBlePlatform,
  meshcoreTargetsSharedMeshtasticBlePeripheral,
  notifyNobleBlePrimaryAutoConnectSettled,
} from '@/renderer/lib/meshcoreDualNobleBleInit';
import {
  isProtocolRfAutoConnectCancelled,
  resetProtocolRfAutoConnectCancel,
} from '@/renderer/lib/protocolRfAutoConnectGate';
import { awaitReticulumBleCoexistenceClear } from '@/renderer/lib/reticulum/reticulumStartupAutostartGate';
import type { RfConnectAutomaticFn } from '@/renderer/lib/rfConnectionTypes';
import { tryGetMeshcoreSession } from '@/renderer/lib/sessions/meshcoreSession';
import { tryGetMeshtasticSession } from '@/renderer/lib/sessions/meshtasticSession';
import { POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS } from '@/renderer/lib/timeConstants';
import type { DeviceState, MeshProtocol } from '@/renderer/lib/types';

import { shouldClearMeshcoreBleSelectionForError } from '../lib/bleConnectErrors';

export interface UseProtocolRfAutoConnectOptions {
  protocol: MeshProtocol;
  state: DeviceState;
  connectAutomatic: RfConnectAutomaticFn;
  enabled?: boolean;
}

const SESSION_READY_POLL_MS = 50;
const SESSION_READY_MAX_WAIT_MS = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Protocol session is registered in a parent useEffect — wait before RF connect. */
async function waitForProtocolSession(protocol: 'meshtastic' | 'meshcore'): Promise<boolean> {
  const deadline = Date.now() + SESSION_READY_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (protocol === 'meshtastic' && tryGetMeshtasticSession()) {
      return true;
    }
    if (protocol === 'meshcore' && tryGetMeshcoreSession()) {
      return true;
    }
    await sleep(SESSION_READY_POLL_MS);
  }
  return false;
}

function notifyPrimaryAutoConnectSettledIfNeeded(protocol: MeshProtocol): void {
  if (dualNobleBleBothRadiosConfigured() && getNobleBleDualRadioPrimaryProtocol() === protocol) {
    notifyNobleBlePrimaryAutoConnectSettled();
  }
}

/** Attach primary-settle side effects without nesting promise handlers inside the BLE callback. */
function watchPrimaryAutoConnectAttempt(protocol: MeshProtocol, attempt: Promise<unknown>): void {
  attempt
    .finally(() => {
      notifyPrimaryAutoConnectSettledIfNeeded(protocol);
    })
    .catch(() => {
      // catch-no-log-ok — reconnectBleWithScan awaits this rejected attempt
    });
}

/**
 * Starts a remembered serial, Noble BLE, or TCP/HTTP RF connection once per mounted protocol.
 *
 * Failure point: a remembered serial device may be unavailable, BLE may never finish
 * connecting, or a TCP/HTTP host may be unreachable. Fallback: serial retries its remembered
 * Noble BLE peripheral; TCP/HTTP has no transport fallback. The 30-second timeout releases
 * the attempt. Failures are logged because no panel-local UI is mounted.
 */
export function useProtocolRfAutoConnect({
  protocol,
  state,
  connectAutomatic,
  enabled = true,
}: UseProtocolRfAutoConnectOptions): void {
  const firedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectAutomaticRef = useRef(connectAutomatic);

  useEffect(() => {
    connectAutomaticRef.current = connectAutomatic;
  }, [connectAutomatic]);

  useEffect(() => {
    if (!enabled || protocol === 'reticulum' || firedRef.current) return;
    if (state.status !== 'disconnected') {
      firedRef.current = true;
      notifyPrimaryAutoConnectSettledIfNeeded(protocol);
      return;
    }

    const lastConnection = loadLastConnection(protocol);
    if (!lastConnection) {
      firedRef.current = true;
      notifyPrimaryAutoConnectSettledIfNeeded(protocol);
      return;
    }
    firedRef.current = true;
    // Fresh startup attempt — manual Connect may cancel later via cancelProtocolRfAutoConnect.
    resetProtocolRfAutoConnectCancel(protocol);

    const lastBleId = lastConnection.bleDeviceId ?? loadLastBleDeviceId(protocol);
    const isLinux = window.electronAPI.getPlatform() === 'linux';
    let cancelled = false;

    const isCancelled = () => cancelled || isProtocolRfAutoConnectCancelled(protocol);

    const clearAutoConnectTimeout = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    const startAutoConnectTimeout = () => {
      clearAutoConnectTimeout();
      timeoutRef.current = setTimeout(() => {
        console.warn(`[useProtocolRfAutoConnect] ${protocol} auto-connect timed out after 30s`);
      }, 30_000);
    };
    const onAutoConnectCancelled = () => {
      clearAutoConnectTimeout();
      notifyPrimaryAutoConnectSettledIfNeeded(protocol);
    };
    const onAutoConnectFailed = (
      error: unknown,
      transport: 'serial' | 'ble' | 'tcp' | 'http' = 'ble',
    ) => {
      if (
        protocol === 'meshcore' &&
        transport === 'ble' &&
        shouldClearMeshcoreBleSelectionForError(error)
      ) {
        clearStoredBleSelection('meshcore');
      }
      clearAutoConnectTimeout();
      console.warn(
        `[useProtocolRfAutoConnect] ${protocol} ${transport} auto-connect failed: ${errLikeToLogString(error)}`,
      );
      notifyPrimaryAutoConnectSettledIfNeeded(protocol);
    };
    const isAutoConnectAbortError = (error: unknown): boolean =>
      error instanceof DOMException && error.name === 'AbortError';

    const runBleAutoConnect = async (bleId: string) => {
      if (protocol === 'meshcore' && meshcoreTargetsSharedMeshtasticBlePeripheral(bleId)) {
        console.debug(
          `[useProtocolRfAutoConnect] meshcore BLE auto-connect skipped — same peripheral as Meshtastic (${bleId})`,
        );
        onAutoConnectCancelled();
        return;
      }

      if (isRendererNobleBlePlatform()) {
        await awaitReticulumBleCoexistenceClear();
      }
      if (isCancelled()) {
        console.debug(
          `[useProtocolRfAutoConnect] ${protocol} BLE auto-connect cancelled after coexistence wait`,
        );
        onAutoConnectCancelled();
        return;
      }

      if (isNobleBleDualRadioSecondary(protocol)) {
        await awaitNobleBlePrimaryAutoConnectSettled(POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS);
        if (isCancelled()) {
          console.debug(
            `[useProtocolRfAutoConnect] ${protocol} BLE auto-connect cancelled after primary settle`,
          );
          onAutoConnectCancelled();
          return;
        }
        const primary = getNobleBleDualRadioPrimaryProtocol();
        if (primary === 'meshtastic' || primary === 'meshcore') {
          // RfLinkReady unblocks too early — secondary GATT during primary configure drops both.
          await awaitNobleBleProtocolSettle(primary, POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS);
        }
        if (isCancelled()) {
          console.debug(
            `[useProtocolRfAutoConnect] ${protocol} BLE auto-connect cancelled after protocol settle`,
          );
          onAutoConnectCancelled();
          return;
        }
      }

      if (isCancelled()) {
        console.debug(
          `[useProtocolRfAutoConnect] ${protocol} BLE auto-connect cancelled before connect`,
        );
        onAutoConnectCancelled();
        return;
      }

      await reconnectBleWithScan(protocol, bleId, () => {
        if (isCancelled()) {
          return Promise.reject(new DOMException('RF auto-connect cancelled', 'AbortError'));
        }
        const attempt = connectAutomaticRef.current('ble', undefined, undefined, bleId);
        if (
          dualNobleBleBothRadiosConfigured() &&
          getNobleBleDualRadioPrimaryProtocol() === protocol
        ) {
          watchPrimaryAutoConnectAttempt(protocol, attempt);
        }
        return attempt;
      });
      clearAutoConnectTimeout();
    };

    const onSerialAutoConnectFailed = (error: unknown) => {
      if (isCancelled() || isAutoConnectAbortError(error)) {
        onAutoConnectCancelled();
        return;
      }
      if (lastBleId && !isLinux) {
        console.warn(
          `[useProtocolRfAutoConnect] serial auto-connect failed for ${protocol}; falling back to BLE noble scan: ${errLikeToLogString(error)}`,
        );
        const bleLast: LastConnection = {
          type: 'ble',
          bleDeviceId: lastBleId,
          bleDeviceName: lastConnection.bleDeviceName,
        };
        saveLastConnection(protocol, bleLast);
        runBleAutoConnect(lastBleId)
          .then(() => {
            clearAutoConnectTimeout();
            notifyPrimaryAutoConnectSettledIfNeeded(protocol);
          })
          .catch((bleError: unknown) => {
            if (isCancelled() || isAutoConnectAbortError(bleError)) {
              onAutoConnectCancelled();
              return;
            }
            onAutoConnectFailed(bleError);
          });
        return;
      }
      onAutoConnectFailed(error, 'serial');
    };

    const onTcpAutoConnectFailed = (error: unknown) => {
      if (isCancelled() || isAutoConnectAbortError(error)) {
        onAutoConnectCancelled();
        return;
      }
      const transport = lastConnection.type === 'http' ? 'http' : 'tcp';
      onAutoConnectFailed(error, transport);
    };

    const runStartupAutoConnect = async (): Promise<void> => {
      const ready = await waitForProtocolSession(protocol);
      if (isCancelled()) {
        onAutoConnectCancelled();
        return;
      }
      if (!ready) {
        console.warn(
          `[useProtocolRfAutoConnect] ${protocol} auto-connect skipped — runtime session never registered`,
        );
        onAutoConnectCancelled();
        return;
      }

      if (isCancelled()) {
        onAutoConnectCancelled();
        return;
      }

      if (lastConnection.type === 'serial') {
        startAutoConnectTimeout();
        connectAutomaticRef
          .current('serial', undefined, lastConnection.serialPortId)
          .then(() => {
            clearAutoConnectTimeout();
            notifyPrimaryAutoConnectSettledIfNeeded(protocol);
          })
          .catch(onSerialAutoConnectFailed);
        return;
      }

      if (lastConnection.type === 'ble' && lastBleId && !isLinux) {
        runBleAutoConnect(lastBleId)
          .then(() => {
            clearAutoConnectTimeout();
            notifyPrimaryAutoConnectSettledIfNeeded(protocol);
          })
          .catch((error: unknown) => {
            if (isCancelled() || isAutoConnectAbortError(error)) {
              onAutoConnectCancelled();
              return;
            }
            onAutoConnectFailed(error);
          });
        return;
      }

      if (lastConnection.type === 'http' || lastConnection.type === 'tcp') {
        const addr = lastConnection.httpAddress?.trim();
        if (addr) {
          startAutoConnectTimeout();
          connectAutomaticRef
            .current(lastConnection.type, addr)
            .then(() => {
              clearAutoConnectTimeout();
              notifyPrimaryAutoConnectSettledIfNeeded(protocol);
            })
            .catch(onTcpAutoConnectFailed);
          return;
        }
      }

      onAutoConnectCancelled();
    };

    runStartupAutoConnect().catch((error: unknown) => {
      if (isCancelled() || isAutoConnectAbortError(error)) {
        onAutoConnectCancelled();
        return;
      }
      onAutoConnectFailed(error);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, protocol, state.status]);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    if (state.status === 'configured' && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [state.status]);
}
