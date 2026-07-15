import { useEffect } from 'react';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';
import { MS_PER_SECOND } from '@/shared/timeConstants';

export function shouldRunPropagationAutoSync(args: {
  autoSyncIntervalSec: number;
  preferredId: string | null;
  syncActive: boolean;
  lastPropagationSyncAt: number | null;
  lastPropagationSyncAttemptAt: number | null;
  nowMs: number;
}): boolean {
  const {
    autoSyncIntervalSec,
    preferredId,
    syncActive,
    lastPropagationSyncAt,
    lastPropagationSyncAttemptAt,
    nowMs,
  } = args;
  // Local inbox is served in-process; auto-sync must target a remote PN only.
  if (!preferredId || preferredId === 'local-prop' || autoSyncIntervalSec <= 0 || syncActive) {
    return false;
  }

  // Prefer last attempt so failures still honor the full interval (not every 30s check).
  // Fall back to last success for sessions that have synced before attempts were tracked.
  // Both null → allow one first sync.
  const lastMs = lastPropagationSyncAttemptAt ?? lastPropagationSyncAt ?? Number.NEGATIVE_INFINITY;
  if (lastMs === Number.NEGATIVE_INFINITY) return true;

  return nowMs - lastMs >= autoSyncIntervalSec * MS_PER_SECOND;
}

const AUTO_SYNC_CHECK_MS = 30 * MS_PER_SECOND;

/** Periodically sync the preferred propagation node when auto-sync is enabled. */
export function useReticulumPropagationAutoSync(sidecarReady: boolean): void {
  useEffect(() => {
    if (!sidecarReady) return;

    // Keep preferred/nodes fresh for Chat notice + auto-sync even if Network tab was never opened.
    void useReticulumPropagationStore.getState().refreshFromSidecar();

    const tick = () => {
      const {
        autoSyncIntervalSec,
        preferredId,
        sync,
        lastPropagationSyncAt,
        lastPropagationSyncAttemptAt,
        startSync,
      } = useReticulumPropagationStore.getState();
      if (
        !shouldRunPropagationAutoSync({
          autoSyncIntervalSec,
          preferredId,
          syncActive: sync.active,
          lastPropagationSyncAt,
          lastPropagationSyncAttemptAt,
          nowMs: Date.now(),
        })
      ) {
        return;
      }
      void startSync(preferredId!);
    };

    const id = window.setInterval(tick, AUTO_SYNC_CHECK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [sidecarReady]);
}
