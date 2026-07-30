import { useEffect } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  runSessionDbPrune,
  runStartupDbPrune,
  SESSION_DB_PRUNE_INTERVAL_MS,
} from '@/renderer/lib/startupDbPrune';

/** Run SQLite retention prune once at startup, then every {@link SESSION_DB_PRUNE_INTERVAL_MS}. */
export function useAppStartupDbPrune(onAfterPrune: () => void): void {
  useEffect(() => {
    // floating-ok: runStartupDbPrune swallows per-op IPC errors; catch covers unexpected throws.
    void runStartupDbPrune()
      .then(onAfterPrune)
      .catch((e: unknown) => {
        console.warn('[useAppStartupDbPrune] startup prune failed ' + errLikeToLogString(e));
      });
    const intervalId = setInterval(() => {
      // floating-ok: runSessionDbPrune swallows per-op IPC errors; catch covers unexpected throws.
      void runSessionDbPrune().catch((e: unknown) => {
        console.warn('[useAppStartupDbPrune] session prune failed ' + errLikeToLogString(e));
      });
    }, SESSION_DB_PRUNE_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [onAfterPrune]);
}
