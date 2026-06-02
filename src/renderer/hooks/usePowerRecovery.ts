import { useEffect, useRef } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { setSystemSuspended } from '@/renderer/lib/systemPowerState';

/** macOS BLE stack needs a few seconds after wake before connect/scan succeeds reliably. */
export const POWER_RESUME_RECOVERY_DELAY_MS = 4_000;

export interface PowerRecoveryCallbacks {
  onPowerSuspend: () => void;
  onPowerResume: () => void;
}

export interface UsePowerRecoveryOptions {
  meshtastic: PowerRecoveryCallbacks;
  meshcore: PowerRecoveryCallbacks;
}

export function usePowerRecovery({ meshtastic, meshcore }: UsePowerRecoveryOptions): void {
  const meshtasticRef = useRef(meshtastic);
  const meshcoreRef = useRef(meshcore);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    meshtasticRef.current = meshtastic;
    meshcoreRef.current = meshcore;
  });

  useEffect(() => {
    const offSuspend = window.electronAPI.onPowerSuspend(() => {
      console.debug('[usePowerRecovery] system suspend');
      if (resumeTimerRef.current != null) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
      setSystemSuspended(true);
      meshtasticRef.current.onPowerSuspend();
      meshcoreRef.current.onPowerSuspend();
      void window.electronAPI.mqtt.powerSuspend().catch((e: unknown) => {
        console.debug('[usePowerRecovery] mqtt.powerSuspend ' + errLikeToLogString(e));
      });
    });

    const offResume = window.electronAPI.onPowerResume(() => {
      console.debug('[usePowerRecovery] system resume — scheduling recovery');
      setSystemSuspended(false);
      if (resumeTimerRef.current != null) {
        clearTimeout(resumeTimerRef.current);
      }
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null;
        console.debug('[usePowerRecovery] resume recovery');
        void window.electronAPI.mqtt.powerResume().catch((e: unknown) => {
          console.warn('[usePowerRecovery] mqtt.powerResume failed ' + errLikeToLogString(e));
        });
        meshtasticRef.current.onPowerResume();
        meshcoreRef.current.onPowerResume();
      }, POWER_RESUME_RECOVERY_DELAY_MS);
    });

    return () => {
      offSuspend();
      offResume();
      if (resumeTimerRef.current != null) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, []);
}
