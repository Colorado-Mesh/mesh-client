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
  /** Synchronous mirror — React state lags a frame and can release a fresh suspend. */
  const graceExpiresAtRef = useRef(0);
  const yieldStateRef = useRef({ yieldActive: false });
  const nowMs = useNowMs(bleConnectGraceExpiresAt > 0, bleConnectGraceExpiresAt > 0 ? 1_000 : 0);

  useEffect(() => {
    if (sidecarActive) {
      const expires = Date.now() + RETICULUM_BLE_CONNECT_GRACE_MS;
      graceExpiresAtRef.current = expires;
      setBleConnectGraceExpiresAt(expires);
      return;
    }
    graceExpiresAtRef.current = 0;
    setBleConnectGraceExpiresAt(0);
    const abort = new AbortController();
    void syncReticulumNobleBleYield(
      {
        sidecarActive: false,
        interfaces: [],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: 0,
        signal: abort.signal,
      },
      yieldStateRef.current,
    );
    return () => {
      abort.abort();
    };
  }, [sidecarActive]);

  useEffect(() => {
    if (!sidecarActive) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        let graceExpiresAt = graceExpiresAtRef.current;
        const coexist =
          (await window.electronAPI?.bleCoexistence?.getState?.().catch(() => null)) ?? null;
        // Stack restart: main re-acquires scan after we already released (yield inactive,
        // grace stale). Do NOT renew while yield is still active — that infinitely extends
        // the hold when an offline BLE RNode never comes up and starves Meshtastic.
        if (
          coexist?.scanOwner === 'reticulum' &&
          !yieldStateRef.current.yieldActive &&
          (graceExpiresAt <= 0 || Date.now() >= graceExpiresAt)
        ) {
          graceExpiresAt = Date.now() + RETICULUM_BLE_CONNECT_GRACE_MS;
          graceExpiresAtRef.current = graceExpiresAt;
          setBleConnectGraceExpiresAt(graceExpiresAt);
        }

        const interfaces = await fetchReticulumInterfaces();
        if (cancelled) return;
        await syncReticulumNobleBleYield(
          {
            sidecarActive: true,
            interfaces,
            nowMs: Date.now(),
            bleConnectGraceExpiresAt: graceExpiresAtRef.current,
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
