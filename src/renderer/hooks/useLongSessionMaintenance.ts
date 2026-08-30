import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MS_PER_DAY, MS_PER_HOUR, MS_PER_SECOND } from '../lib/timeConstants';

/** Main-process uptime before showing a restart suggestion (Noble BLE, macOS/Windows). */
const RESTART_NUDGE_UPTIME_SEC = (4 * MS_PER_DAY) / MS_PER_SECOND;
const RESTART_NUDGE_CHECK_INTERVAL_MS = MS_PER_HOUR;
const RESTART_NUDGE_REPROMPT_MS = 12 * MS_PER_HOUR;

const DISMISSED_AT_KEY = 'mesh-client:longSessionRestartNudgeDismissedAt';

export interface LongSessionMaintenanceState {
  visible: boolean;
  onRestart: () => void;
  onDismiss: () => void;
}

function isNobleRiskPlatform(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32';
}

async function hasActiveNobleBleSession(): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.isNobleBleConnected) return false;
  try {
    const [mt, mc] = await Promise.all([
      api.isNobleBleConnected('meshtastic'),
      api.isNobleBleConnected('meshcore'),
    ]);
    return mt || mc;
  } catch {
    // catch-no-log-ok Noble status probe failures treat as disconnected
    return false;
  }
}

function readDismissedAt(): number | null {
  const raw = sessionStorage.getItem(DISMISSED_AT_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isWithinDismissWindow(now: number): boolean {
  const dismissedAt = readDismissedAt();
  if (dismissedAt == null) return false;
  return now - dismissedAt < RESTART_NUDGE_REPROMPT_MS;
}

/**
 * Persistent restart nudge after 4 days main uptime when Noble BLE is active on
 * macOS/Windows. Drives in-app banner + OS attention cues.
 *
 * The 4-day threshold stays ahead of a ~5-day native abort (EXC_BREAKPOINT / SIGTRAP) that is
 * confirmed on macOS and not catchable from JS. The mechanism is only suspected (native
 * lifetime race in noble's CoreBluetooth binding), and Windows is nudged precautionarily
 * because the same failure class is unconfirmed there:
 * https://github.com/stoprocent/noble/issues/140
 */
export function useLongSessionMaintenance(): LongSessionMaintenanceState {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const osNotifiedRef = useRef(false);

  const setVisibleBoth = useCallback((next: boolean) => {
    visibleRef.current = next;
    setVisible(next);
  }, []);

  const clearOsNudge = useCallback(async () => {
    osNotifiedRef.current = false;
    try {
      await window.electronAPI.notify?.clearLongSessionNudge?.();
    } catch (err) {
      console.debug(
        '[useLongSessionMaintenance] clearLongSessionNudge failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }, []);

  const hideNudge = useCallback(async () => {
    setVisibleBoth(false);
    await clearOsNudge();
  }, [clearOsNudge, setVisibleBoth]);

  const showNudge = useCallback(
    async (uptimeSec: number, nobleSessions: { meshtastic: boolean; meshcore: boolean }) => {
      if (visibleRef.current) return;
      setVisibleBoth(true);
      console.debug(
        `[useLongSessionMaintenance] restart nudge uptimeSec=${uptimeSec} platform=${window.electronAPI.getPlatform()} nobleMeshtastic=${nobleSessions.meshtastic} nobleMeshcore=${nobleSessions.meshcore}`,
      );
      if (osNotifiedRef.current) return;
      osNotifiedRef.current = true;
      try {
        await window.electronAPI.notify.longSessionRestart({
          title: t('longSession.title'),
          body: t('longSession.body'),
          restartLabel: t('longSession.restart'),
          laterLabel: t('longSession.dismiss'),
        });
      } catch (err) {
        console.debug(
          '[useLongSessionMaintenance] notifyLongSessionRestart failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    [setVisibleBoth, t],
  );

  const checkRestartNudge = useCallback(async () => {
    try {
      const platform = window.electronAPI.getPlatform();
      if (!isNobleRiskPlatform(platform)) {
        if (visibleRef.current) await hideNudge();
        return;
      }

      const api = window.electronAPI;
      let meshtastic = false;
      let meshcore = false;
      try {
        const [mt, mc] = await Promise.all([
          api.isNobleBleConnected('meshtastic'),
          api.isNobleBleConnected('meshcore'),
        ]);
        meshtastic = mt;
        meshcore = mc;
      } catch (err) {
        console.debug(
          '[useLongSessionMaintenance] isNobleBleConnected failed:',
          err instanceof Error ? err.message : String(err),
        );
        return;
      }

      const nobleActive = meshtastic || meshcore;
      if (!nobleActive) {
        if (visibleRef.current) await hideNudge();
        return;
      }

      const uptimeSec = await window.electronAPI.getProcessUptimeSec();
      if (uptimeSec < RESTART_NUDGE_UPTIME_SEC) return;

      if (isWithinDismissWindow(Date.now())) return;

      await showNudge(uptimeSec, { meshtastic, meshcore });
    } catch (err) {
      console.debug(
        '[useLongSessionMaintenance] restart nudge check failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }, [hideNudge, showNudge]);

  useEffect(() => {
    // Defer initial check so setState is not synchronous in the effect body.
    queueMicrotask(() => {
      void checkRestartNudge();
    });
    const timer = setInterval(() => {
      void checkRestartNudge();
    }, RESTART_NUDGE_CHECK_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [checkRestartNudge]);

  const onDismiss = useCallback(() => {
    sessionStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    void hideNudge();
  }, [hideNudge]);

  const onRestart = useCallback(() => {
    void (async () => {
      try {
        await clearOsNudge();
      } catch {
        // catch-no-log-ok do not block restart on OS cue clear failure
      }
      try {
        await window.electronAPI.restartApp();
      } catch (err) {
        console.debug(
          '[useLongSessionMaintenance] restartApp failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  }, [clearOsNudge]);

  return { visible, onRestart, onDismiss };
}

/** Test helpers */
export const longSessionMaintenanceTestApi = {
  DISMISSED_AT_KEY,
  RESTART_NUDGE_UPTIME_SEC,
  RESTART_NUDGE_REPROMPT_MS,
  isNobleRiskPlatform,
  hasActiveNobleBleSession,
  isWithinDismissWindow,
  readDismissedAt,
};
