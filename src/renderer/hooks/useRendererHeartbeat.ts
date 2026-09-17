import { useEffect } from 'react';

import { MS_PER_SECOND } from '../lib/timeConstants';

const RENDERER_HEARTBEAT_INTERVAL_MS = 30 * MS_PER_SECOND;

/**
 * Periodic renderer liveness ping so main can detect a hung renderer after system
 * resume and while the window stays visible (stall watchdog). Pauses while the
 * document is hidden; reports that pause to main and resumes on visibilitychange.
 */
export function useRendererHeartbeat(): void {
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const sendHeartbeat = () => {
      void window.electronAPI
        .sendRendererHeartbeat({ ts: Date.now(), hidden: document.hidden })
        .catch((e: unknown) => {
          console.debug('[useRendererHeartbeat] send failed', e);
        });
    };

    const start = () => {
      if (intervalId != null) return;
      sendHeartbeat();
      intervalId = setInterval(sendHeartbeat, RENDERER_HEARTBEAT_INTERVAL_MS);
    };

    const stop = () => {
      if (intervalId == null) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
        sendHeartbeat();
      } else start();
    };

    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
