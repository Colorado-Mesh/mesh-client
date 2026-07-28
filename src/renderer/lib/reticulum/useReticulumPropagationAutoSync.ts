import { useEffect } from 'react';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';
import { MS_PER_SECOND } from '@/shared/timeConstants';

/** After a failed attempt, wait this long before auto-sync may fire again. */
export const PROPAGATION_AUTO_SYNC_FAILURE_COOLDOWN_MS = 120_000;

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

  // Interval is measured from last *success*. Never-succeeded sessions fall back to last
  // attempt so the first failure still honors the configured interval once.
  const intervalAnchorMs = lastPropagationSyncAt ?? lastPropagationSyncAttemptAt;
  if (intervalAnchorMs == null) return true;
  if (nowMs - intervalAnchorMs < autoSyncIntervalSec * MS_PER_SECOND) {
    return false;
  }

  // Short failure gate so a dead PN is not hammered every 30s check tick.
  if (
    lastPropagationSyncAttemptAt != null &&
    nowMs - lastPropagationSyncAttemptAt < PROPAGATION_AUTO_SYNC_FAILURE_COOLDOWN_MS
  ) {
    return false;
  }

  return true;
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
