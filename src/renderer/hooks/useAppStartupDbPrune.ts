import { useEffect } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { nodesExemptFromPositionPrune } from '@/renderer/lib/incidentTrackExemption';
import {
  type DbPruneOptions,
  runSessionDbPrune,
  runStartupDbPrune,
  SESSION_DB_PRUNE_INTERVAL_MS,
} from '@/renderer/lib/startupDbPrune';
import { useIncidentStore } from '@/renderer/stores/incidentStore';

/** Senders of open/acked incidents keep their track through retention prune (S12). */
export function incidentPruneOptions(): DbPruneOptions {
  return {
    exemptNodeIds: nodesExemptFromPositionPrune(
      Object.values(useIncidentStore.getState().incidents),
    ),
  };
}

/** Run SQLite retention prune once at startup, then every {@link SESSION_DB_PRUNE_INTERVAL_MS}. */
export function useAppStartupDbPrune(onAfterPrune: () => void): void {
  useEffect(() => {
    // floating-ok: runStartupDbPrune swallows per-op IPC errors; catch covers unexpected throws.
    void runStartupDbPrune(incidentPruneOptions())
      .then(onAfterPrune)
      .catch((e: unknown) => {
        console.warn('[useAppStartupDbPrune] startup prune failed ' + errLikeToLogString(e));
      });
    const intervalId = setInterval(() => {
      // floating-ok: runSessionDbPrune swallows per-op IPC errors; catch covers unexpected throws.
      void runSessionDbPrune(incidentPruneOptions()).catch((e: unknown) => {
        console.warn('[useAppStartupDbPrune] session prune failed ' + errLikeToLogString(e));
      });
    }, SESSION_DB_PRUNE_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [onAfterPrune]);
}
