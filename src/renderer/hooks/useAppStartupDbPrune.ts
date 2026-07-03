import { useEffect } from 'react';

import {
  runSessionDbPrune,
  runStartupDbPrune,
  SESSION_DB_PRUNE_INTERVAL_MS,
} from '@/renderer/lib/startupDbPrune';

/** Run SQLite retention prune once at startup, then every {@link SESSION_DB_PRUNE_INTERVAL_MS}. */
export function useAppStartupDbPrune(onAfterPrune: () => void): void {
  useEffect(() => {
    void runStartupDbPrune().then(onAfterPrune);
    const intervalId = setInterval(() => {
      void runSessionDbPrune();
    }, SESSION_DB_PRUNE_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [onAfterPrune]);
}
