import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { normalizeRrcHubHash } from '@/renderer/lib/rrcMessageStorageCommon';
import { isCacheableRrcIdentityHash } from '@/renderer/lib/rrcNickPersist';
import { type RrcCachedNick, useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

const hydratedHubs = new Set<string>();

export function resetRrcNickCacheHydrationForTests(): void {
  hydratedHubs.clear();
}

/**
 * Load one hub's cached nicks into the session store. Once per hub per session —
 * later names arrive live via `learnHubNicks`.
 *
 * Failure point: IPC/DB unavailable — log and fall back to transcript-derived nicks.
 */
export async function hydrateRrcHubNicks(hubHash: string): Promise<void> {
  const hub = normalizeRrcHubHash(hubHash);
  if (!hub || hydratedHubs.has(hub)) return;
  hydratedHubs.add(hub);
  try {
    const rows = await window.electronAPI.db.listRrcNicks(hub);
    const nicks: RrcCachedNick[] = [];
    for (const row of rows) {
      const hash = row.identity_hash.trim().toLowerCase();
      const nickname = row.nickname.trim();
      if (!nickname || !isCacheableRrcIdentityHash(hash)) continue;
      nicks.push({ hash, nickname });
    }
    if (nicks.length > 0) useRrcSessionStore.getState().hydrateHubNicks(hub, nicks);
  } catch (e: unknown) {
    hydratedHubs.delete(hub);
    console.warn('[rrcNickCacheHydrate] load failed ' + errLikeToLogString(e));
  }
}
