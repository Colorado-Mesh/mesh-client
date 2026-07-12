/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react';

import { useNowMs } from '@/renderer/hooks/useNowMs';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  RETICULUM_BLE_CONNECT_GRACE_MS,
  RETICULUM_LOCAL_HEALTH_FAST_POLL_MS,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh';
import { syncReticulumNobleBleYield } from '@/renderer/lib/reticulum/reticulumNobleBleYield';
import { fetchReticulumInterfaces } from '@/renderer/lib/reticulum/reticulumSidecarReads';

/** Always-mounted Noble BLE yield lifecycle while the Reticulum sidecar is active. */
export function useReticulumNobleBleYieldWatcher(sidecarActive: boolean): void {
  const [bleConnectGraceExpiresAt, setBleConnectGraceExpiresAt] = useState(0);
  const yieldStateRef = useRef({ yieldActive: false });
  const nowMs = useNowMs(bleConnectGraceExpiresAt > 0, bleConnectGraceExpiresAt > 0 ? 1_000 : 0);

  useEffect(() => {
    if (sidecarActive) {
      setBleConnectGraceExpiresAt(Date.now() + RETICULUM_BLE_CONNECT_GRACE_MS);
      return;
    }
    setBleConnectGraceExpiresAt(0);
    void syncReticulumNobleBleYield(
      {
        sidecarActive: false,
        interfaces: [],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: 0,
      },
      yieldStateRef.current,
    );
  }, [sidecarActive]);

  useEffect(() => {
    if (!sidecarActive) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const interfaces = await fetchReticulumInterfaces();
        if (cancelled) return;
        await syncReticulumNobleBleYield(
          {
            sidecarActive: true,
            interfaces,
            nowMs: Date.now(),
            bleConnectGraceExpiresAt,
          },
          yieldStateRef.current,
        );
      } catch (e) {
        console.debug('[useReticulumNobleBleYieldWatcher] tick ' + errLikeToLogString(e));
      }
    };

    void tick();
    const intervalId = window.setInterval(() => {
      void tick();
    }, RETICULUM_LOCAL_HEALTH_FAST_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [sidecarActive, bleConnectGraceExpiresAt, nowMs]);
}
