import { useEffect, useRef } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { setSystemSuspended } from '@/renderer/lib/systemPowerState';
import type { MeshProtocol } from '@/renderer/lib/types';

/** macOS BLE stack needs a few seconds after wake before connect/scan succeeds reliably. */
export const POWER_RESUME_RECOVERY_DELAY_MS = 4_000;

/** Stagger MeshCore RF reconnect after Meshtastic to avoid dual-protocol Noble scan contention. */
export const POWER_RESUME_MESHCORE_STAGGER_MS = 8_000;

export interface PowerRecoveryCallbacks {
  onPowerSuspend: () => void;
  onPowerResume: () => void;
}

/** Default wake resume order preserves historical Meshtastic-then-MeshCore stagger. */
export const DEFAULT_POWER_RESUME_SCHEDULE: readonly {
  protocol: MeshProtocol;
  delayMs: number;
}[] = [
  { protocol: 'meshtastic', delayMs: POWER_RESUME_RECOVERY_DELAY_MS },
  {
    protocol: 'meshcore',
    delayMs: POWER_RESUME_RECOVERY_DELAY_MS + POWER_RESUME_MESHCORE_STAGGER_MS,
  },
  {
    protocol: 'reticulum',
    delayMs: POWER_RESUME_RECOVERY_DELAY_MS + POWER_RESUME_MESHCORE_STAGGER_MS + 4_000,
  },
];

export interface UsePowerRecoveryOptions {
  callbacksByProtocol: Record<MeshProtocol, PowerRecoveryCallbacks>;
  resumeSchedule?: readonly { protocol: MeshProtocol; delayMs: number }[];
}

interface LegacyPowerRecoveryOptions {
  meshtastic: PowerRecoveryCallbacks;
  meshcore: PowerRecoveryCallbacks;
}

export function usePowerRecovery(
  options: UsePowerRecoveryOptions | LegacyPowerRecoveryOptions,
): void {
  const callbacksByProtocol: Record<MeshProtocol, PowerRecoveryCallbacks> =
    'callbacksByProtocol' in options
      ? options.callbacksByProtocol
      : {
          meshtastic: options.meshtastic,
          meshcore: options.meshcore,
          // Legacy shape (no explicit Reticulum entry) is test-only today — production wiring
          // (App.tsx) always passes `callbacksByProtocol` with a real Reticulum entry. The real
          // `useReticulumRuntime.onPowerSuspend` bumps a `resumeGenerationRef` (mirroring
          // Meshtastic/MeshCore's `reconnectGenerationRef`) so a stale in-flight `connect()`
          // started before an earlier suspend can't clobber a fresher post-resume state; this
          // no-op fallback only applies when a caller opts into the legacy two-protocol shape.
          reticulum: { onPowerSuspend: () => {}, onPowerResume: () => {} },
        };
  const resumeSchedule =
    'resumeSchedule' in options && options.resumeSchedule
      ? options.resumeSchedule
      : DEFAULT_POWER_RESUME_SCHEDULE;

  const callbacksRef = useRef(callbacksByProtocol);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    callbacksRef.current = callbacksByProtocol;
  });

  useEffect(() => {
    const clearTimers = () => {
      for (const t of timersRef.current) {
        clearTimeout(t);
      }
      timersRef.current = [];
    };

    const offSuspend = window.electronAPI.onPowerSuspend(() => {
      console.debug('[usePowerRecovery] system suspend');
      clearTimers();
      setSystemSuspended(true);
      for (const cb of Object.values(callbacksRef.current)) {
        cb.onPowerSuspend();
      }
      void window.electronAPI.mqtt.powerSuspend().catch((e: unknown) => {
        console.debug('[usePowerRecovery] mqtt.powerSuspend ' + errLikeToLogString(e));
      });
    });

    const offResume = window.electronAPI.onPowerResume(() => {
      console.debug('[usePowerRecovery] system resume — scheduling recovery');
      setSystemSuspended(false);
      clearTimers();
      void window.electronAPI.mqtt.powerResume().catch((e: unknown) => {
        console.warn('[usePowerRecovery] mqtt.powerResume failed ' + errLikeToLogString(e));
      });

      for (const { protocol, delayMs } of resumeSchedule) {
        const cb = callbacksRef.current[protocol];
        if (!cb) continue;
        const timer = setTimeout(() => {
          console.debug(`[usePowerRecovery] resume recovery (${protocol})`);
          cb.onPowerResume();
        }, delayMs);
        timersRef.current.push(timer);
      }
    });

    return () => {
      offSuspend();
      offResume();
      clearTimers();
    };
  }, [resumeSchedule]);
}
