import {
  hasEnabledLocalPropagationNode,
  listConfiguredRemotePropagationIds,
  listDiscoveredPropagationTargets,
  readReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

/** Cap Auto discovered one-time sync attempts so a long failure chain cannot hang Sync. */
const MAX_DISCOVERED_SYNC_ATTEMPTS = 3;

async function startSyncId(id: string): Promise<boolean> {
  return useReticulumPropagationStore.getState().startSync(id);
}

async function tryLocalSettleIfEnabled(): Promise<boolean> {
  const { nodes } = useReticulumPropagationStore.getState();
  if (!hasEnabledLocalPropagationNode(nodes)) return false;
  return startSyncId('local-prop');
}

/** True when the sidecar reports at least one enabled interface. Fail open on read errors. */
export async function fetchHasEnabledReticulumInterfaces(): Promise<boolean> {
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
      interfaces?: { enabled?: boolean }[];
    };
    const rows = body.interfaces ?? [];
    return rows.some((row) => row.enabled === true);
  } catch (e) {
    console.warn('[reticulumPropagationAutoApply] interfaces read failed', e);
    return true;
  }
}

/**
 * Auto: best discovered (one-time sync by hash — **no** Add, **no** Preferred) →
 * configured remotes → local-prop settle.
 * Manual/Off: explicit first target or Preferred, then local on failure.
 */
export async function startPropagationSyncCascade(opts?: {
  /** Per-row Sync or resolved Preferred; optional for Auto (uses discovered/configured lists). */
  firstTargetId?: string | null;
  /**
   * When false, skip discovered/remote sync and settle local-prop (no active interfaces).
   * When omitted, Auto probes `/api/v1/interfaces`.
   */
  hasEnabledInterfaces?: boolean;
}): Promise<boolean> {
  const mode = readReticulumPropagationMode();
  const state = useReticulumPropagationStore.getState();
  const { nodes, preferredId, discovered } = state;
  const first = opts?.firstTargetId ?? null;

  if (mode === 'auto') {
    const hasInterfaces =
      opts?.hasEnabledInterfaces ?? (await fetchHasEnabledReticulumInterfaces());
    if (!hasInterfaces) {
      return tryLocalSettleIfEnabled();
    }

    const triedHashes = new Set<string>();
    const discoveredTargets = listDiscoveredPropagationTargets(nodes, discovered).slice(
      0,
      MAX_DISCOVERED_SYNC_ATTEMPTS,
    );

    for (const target of discoveredTargets) {
      if (readReticulumPropagationMode() !== 'auto') return false;
      const hash = target.destinationHash.toLowerCase();
      triedHashes.add(hash);
      if (await startSyncId(hash)) return true;
    }

    for (const id of listConfiguredRemotePropagationIds(
      useReticulumPropagationStore.getState().nodes,
    )) {
      const row = useReticulumPropagationStore.getState().nodes.find((n) => n.id === id);
      const hash = row?.destination_hash?.toLowerCase();
      if (hash != null && triedHashes.has(hash)) continue;
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
 * `targetId` seeds Manual/Off (and Auto bottom-sync hint); local-prop / dest hashes allowed.
 */
export async function ensurePreferredThenStartSync(targetId: string): Promise<boolean> {
  return startPropagationSyncCascade({ firstTargetId: targetId });
}
