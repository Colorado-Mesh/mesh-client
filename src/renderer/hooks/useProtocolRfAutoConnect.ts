import { useEffect, useRef } from 'react';

import { reconnectBleWithScan } from '@/renderer/lib/bleReconnectHelper';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
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
import { awaitReticulumBleCoexistenceClear } from '@/renderer/lib/reticulum/reticulumStartupAutostartGate';
import type { RfConnectAutomaticFn } from '@/renderer/lib/rfConnectionTypes';
import { tryGetMeshcoreSession } from '@/renderer/lib/sessions/meshcoreSession';
import { tryGetMeshtasticSession } from '@/renderer/lib/sessions/meshtasticSession';
import { POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS } from '@/renderer/lib/timeConstants';
import type { DeviceState, MeshProtocol } from '@/renderer/lib/types';

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
 * Starts a remembered serial or Noble BLE RF connection once per mounted protocol.
 *
 * Failure point: a remembered serial device may be unavailable, or BLE may never finish
 * connecting. Fallback: serial retries its remembered Noble BLE peripheral; the 30-second
 * timeout releases the attempt. Failures are logged because no panel-local UI is mounted.
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

    const lastBleId = lastConnection.bleDeviceId ?? loadLastBleDeviceId(protocol);
    const isLinux = window.electronAPI.getPlatform() === 'linux';
    let cancelled = false;

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
    const onAutoConnectFailed = (error: unknown, transport: 'serial' | 'ble' = 'ble') => {
      clearAutoConnectTimeout();
      console.warn(
        `[useProtocolRfAutoConnect] ${protocol} ${transport} auto-connect failed: ${errLikeToLogString(error)}`,
      );
    };

    const runBleAutoConnect = async (bleId: string) => {
      if (protocol === 'meshcore' && meshcoreTargetsSharedMeshtasticBlePeripheral(bleId)) {
        console.debug(
          `[useProtocolRfAutoConnect] meshcore BLE auto-connect skipped — same peripheral as Meshtastic (${bleId})`,
        );
        notifyPrimaryAutoConnectSettledIfNeeded(protocol);
        return;
      }

      if (isRendererNobleBlePlatform()) {
        await awaitReticulumBleCoexistenceClear();
      }

      if (isNobleBleDualRadioSecondary(protocol)) {
        await awaitNobleBlePrimaryAutoConnectSettled(POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS);
        const primary = getNobleBleDualRadioPrimaryProtocol();
        if (primary === 'meshtastic' || primary === 'meshcore') {
          // RfLinkReady unblocks too early — secondary GATT during primary configure drops both.
          await awaitNobleBleProtocolSettle(primary, POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS);
        }
      }

      await reconnectBleWithScan(protocol, bleId, () => {
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
      if (cancelled) return;
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
        runBleAutoConnect(lastBleId).catch(onAutoConnectFailed);
        return;
      }
      onAutoConnectFailed(error, 'serial');
      notifyPrimaryAutoConnectSettledIfNeeded(protocol);
    };

    const runStartupAutoConnect = async (): Promise<void> => {
      const ready = await waitForProtocolSession(protocol);
      if (cancelled) return;
      if (!ready) {
        console.warn(
          `[useProtocolRfAutoConnect] ${protocol} auto-connect skipped — runtime session never registered`,
        );
        notifyPrimaryAutoConnectSettledIfNeeded(protocol);
        return;
      }

      if (lastConnection.type === 'serial') {
        startAutoConnectTimeout();
        connectAutomaticRef
          .current('serial', undefined, lastConnection.serialPortId)
          .catch(onSerialAutoConnectFailed);
        return;
      }

      if (lastConnection.type === 'ble' && lastBleId && !isLinux) {
        runBleAutoConnect(lastBleId).catch(onAutoConnectFailed);
        return;
      }

      notifyPrimaryAutoConnectSettledIfNeeded(protocol);
    };

    runStartupAutoConnect().catch((error: unknown) => {
      if (cancelled) return;
      onAutoConnectFailed(error);
      notifyPrimaryAutoConnectSettledIfNeeded(protocol);
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
