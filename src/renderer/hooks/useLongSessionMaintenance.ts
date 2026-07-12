import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../components/Toast';

/** Main-process uptime before showing a one-time restart suggestion toast. */
const RESTART_NUDGE_UPTIME_SEC = 4 * 24 * 60 * 60;
const RESTART_NUDGE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const RESTART_NUDGE_SHOWN_KEY = 'mesh-client:longSessionRestartNudgeShown';

/** One-time restart nudge after several days of main-process uptime. */
export function useLongSessionMaintenance(): void {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const restartNudgeShownRef = useRef(sessionStorage.getItem(RESTART_NUDGE_SHOWN_KEY) === '1');

  useEffect(() => {
    const checkRestartNudge = async () => {
      if (restartNudgeShownRef.current) return;
      try {
        const uptimeSec = await window.electronAPI.getProcessUptimeSec();
        if (uptimeSec < RESTART_NUDGE_UPTIME_SEC) return;
        restartNudgeShownRef.current = true;
        sessionStorage.setItem(RESTART_NUDGE_SHOWN_KEY, '1');
        addToast(t('toasts.longSessionRestartNudge'), 'warning', 12_000);
      } catch (err) {
        console.debug(
          '[useLongSessionMaintenance] restart nudge check failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    };

    void checkRestartNudge();
    const timer = setInterval(() => {
      void checkRestartNudge();
    }, RESTART_NUDGE_CHECK_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [addToast, t]);
}
