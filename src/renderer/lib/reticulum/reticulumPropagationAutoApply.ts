import {
  hasEnabledLocalPropagationNode,
  listConfiguredRemotePropagationIds,
  readReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

async function startSyncId(id: string): Promise<boolean> {
  return useReticulumPropagationStore.getState().startSync(id);
}

async function tryLocalSettleIfEnabled(): Promise<boolean> {
  const { nodes } = useReticulumPropagationStore.getState();
  if (!hasEnabledLocalPropagationNode(nodes)) return false;
  return startSyncId('local-prop');
}

/**
 * Auto: sync configured remotes (hop-sorted), then local-prop settle.
 * Does **not** add discovered nodes or write Preferred — Manual owns those.
 * Manual/Off: explicit first target or Preferred, then local on failure.
 */
export async function startPropagationSyncCascade(opts?: {
  /** Per-row Sync or resolved Preferred; optional for Auto (uses configured list). */
  firstTargetId?: string | null;
}): Promise<boolean> {
  const mode = readReticulumPropagationMode();
  const state = useReticulumPropagationStore.getState();
  const { nodes, preferredId } = state;
  const first = opts?.firstTargetId ?? null;

  if (mode === 'auto') {
    for (const id of listConfiguredRemotePropagationIds(nodes)) {
      if (await startSyncId(id)) return true;
    }
    return tryLocalSettleIfEnabled();
  }

  // Manual / Off: explicit first target, else Preferred, then local fallback.
  const target =
    first && first.length > 0 ? first : preferredId && preferredId.length > 0 ? preferredId : null;

  if (target === 'local-prop') {
    return tryLocalSettleIfEnabled();
  }

  if (target) {
    if (await startSyncId(target)) return true;
  }

  return tryLocalSettleIfEnabled();
}

/**
 * Run the mode-appropriate sync cascade.
 * `targetId` seeds Manual/Off (and Auto bottom-sync hint); local-prop is allowed.
 */
export async function ensurePreferredThenStartSync(targetId: string): Promise<boolean> {
  return startPropagationSyncCascade({ firstTargetId: targetId });
}
