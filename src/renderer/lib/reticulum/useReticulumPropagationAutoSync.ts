import { useEffect } from 'react';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';
import { MS_PER_SECOND } from '@/shared/timeConstants';

export function shouldRunPropagationAutoSync(args: {
  autoSyncIntervalSec: number;
  preferredId: string | null;
  syncActive: boolean;
  lastPropagationSyncAt: number | null;
  nowMs: number;
}): boolean {
  const { autoSyncIntervalSec, preferredId, syncActive, lastPropagationSyncAt, nowMs } = args;
  if (!preferredId || autoSyncIntervalSec <= 0 || syncActive) return false;
  const lastMs = lastPropagationSyncAt ?? 0;
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
      const { autoSyncIntervalSec, preferredId, sync, lastPropagationSyncAt, startSync } =
        useReticulumPropagationStore.getState();
      if (
        !shouldRunPropagationAutoSync({
          autoSyncIntervalSec,
          preferredId,
          syncActive: sync.active,
          lastPropagationSyncAt,
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
