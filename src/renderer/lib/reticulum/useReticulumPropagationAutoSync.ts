import { useEffect } from 'react';

import { startPropagationSyncCascade } from '@/renderer/lib/reticulum/reticulumPropagationAutoApply';
import {
  hasPropagationCascadeCandidate,
  readReticulumPropagationMode,
  type ReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';
import { MS_PER_SECOND } from '@/shared/timeConstants';

/** After a failed attempt, wait this long before auto-sync may fire again. */
export const PROPAGATION_AUTO_SYNC_FAILURE_COOLDOWN_MS = 120_000;

export function shouldRunPropagationAutoSync(args: {
  autoSyncIntervalSec: number;
  /** Preferred or resolved sync target; may be `local-prop` for Manual/Auto final settle. */
  preferredId: string | null;
  syncActive: boolean;
  lastPropagationSyncAt: number | null;
  lastPropagationSyncAttemptAt: number | null;
  nowMs: number;
  /** Propagation mode; `off` never runs periodic sync. */
  mode?: ReticulumPropagationMode;
  /** Auto/Manual may run with null Preferred when a cascade target exists for that mode. */
  hasCascadeCandidate?: boolean;
}): boolean {
  const {
    autoSyncIntervalSec,
    preferredId,
    syncActive,
    lastPropagationSyncAt,
    lastPropagationSyncAttemptAt,
    nowMs,
    mode,
    hasCascadeCandidate,
  } = args;
  // Mode "off" disables all periodic sync (no automatic PN retrieval).
  if (mode === 'off') return false;
  if (autoSyncIntervalSec <= 0 || syncActive) return false;
  // Manual without Preferred picks a configured remote (or local) for this sync only.
  if (!preferredId && !hasCascadeCandidate) return false;

  // Interval is measured from last *success*. Never-succeeded sessions fall back to last
  // attempt so the first failure still honors the configured interval once.
  const intervalAnchorMs = lastPropagationSyncAt ?? lastPropagationSyncAttemptAt;
  if (intervalAnchorMs == null) return true;
  if (nowMs - intervalAnchorMs < autoSyncIntervalSec * MS_PER_SECOND) {
    return false;
  }

  // Failure cooldown only when the latest attempt is after the last success (or never
  // succeeded). A retained attempt stamp from a successful sync must not delay the interval.
  if (
    lastPropagationSyncAttemptAt != null &&
    (lastPropagationSyncAt == null || lastPropagationSyncAttemptAt > lastPropagationSyncAt) &&
    nowMs - lastPropagationSyncAttemptAt < PROPAGATION_AUTO_SYNC_FAILURE_COOLDOWN_MS
  ) {
    return false;
  }

  return true;
}

const AUTO_SYNC_CHECK_MS = 30 * MS_PER_SECOND;

/**
 * Periodically sync discovered/configured remotes (Auto) or Preferred/picked remotes
 * (Manual) when the interval is enabled. Neither mode adds discovered nodes or rewrites
 * Preferred; Off runs no periodic sync.
 */
export function useReticulumPropagationAutoSync(sidecarReady: boolean): void {
  useEffect(() => {
    if (!sidecarReady) return;

    // Keep preferred/nodes fresh for Chat notice + auto-sync even if Network tab was never opened.
    void useReticulumPropagationStore
      .getState()
      .refreshFromSidecar()
      .catch((err: unknown) => {
        console.warn('[useReticulumPropagationAutoSync] refreshFromSidecar rejected', err);
      });
    // Re-push the mode so a restarted sidecar gates its outbound PN cascade the same way.
    void useReticulumPropagationStore
      .getState()
      .setModeOnSidecar(readReticulumPropagationMode())
      .catch((err: unknown) => {
        console.warn('[useReticulumPropagationAutoSync] setModeOnSidecar rejected', err);
      });

    const cascadeCandidate = (mode: ReticulumPropagationMode): boolean => {
      const { nodes, discovered } = useReticulumPropagationStore.getState();
      return hasPropagationCascadeCandidate(mode, nodes, discovered);
    };

    const tick = async () => {
      const mode = readReticulumPropagationMode();
      // Nothing to sync with yet (fresh stack: no announces, local messagestore still
      // loading). Re-read the sidecar so Auto/Manual recover on a later tick.
      if (mode !== 'off' && !cascadeCandidate(mode)) {
        await useReticulumPropagationStore.getState().refreshFromSidecar();
      }

      const {
        autoSyncIntervalSec,
        preferredId,
        sync,
        lastPropagationSyncAt,
        lastPropagationSyncAttemptAt,
      } = useReticulumPropagationStore.getState();

      if (
        !shouldRunPropagationAutoSync({
          autoSyncIntervalSec,
          preferredId,
          syncActive: sync.active,
          lastPropagationSyncAt,
          lastPropagationSyncAttemptAt,
          nowMs: Date.now(),
          mode,
          hasCascadeCandidate: cascadeCandidate(mode),
        })
      ) {
        return;
      }
      await startPropagationSyncCascade();
    };

    const runTick = () => {
      void tick().catch((err: unknown) => {
        console.warn('[useReticulumPropagationAutoSync] tick rejected', err);
      });
    };
    runTick();

    const id = window.setInterval(runTick, AUTO_SYNC_CHECK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [sidecarReady]);
}
