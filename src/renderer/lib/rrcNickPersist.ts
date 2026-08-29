import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { normalizeRrcHubHash } from '@/renderer/lib/rrcMessageStorageCommon';

/** Reject `nick:<name>` synthetic keys and short prefixes — cache real identities only. */
export function isCacheableRrcIdentityHash(hash: string): boolean {
  return /^[0-9a-f]{8,64}$/.test(hash.trim().toLowerCase());
}

/**
 * Fire-and-forget upsert of one hub nick sighting.
 * Failure point: IPC/DB unavailable — log and keep the in-memory cache.
 */
export function persistRrcNick(hubHash: string, identityHash: string, nickname: string): void {
  const hub = normalizeRrcHubHash(hubHash);
  const hash = identityHash.trim().toLowerCase();
  const nick = nickname.trim();
  if (!hub || !nick || !isCacheableRrcIdentityHash(hash)) return;
  // Roster merges also run in non-DOM unit tests; the cache is best-effort.
  const db =
    typeof window === 'undefined'
      ? undefined
      : // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard: preload bridge may be absent in unit tests.
        (window.electronAPI?.db as typeof window.electronAPI.db | undefined);
  if (!db) return;
  void db
    .upsertRrcNick({
      hub_hash: hub,
      identity_hash: hash,
      nickname: nick,
      last_seen: Date.now(),
    })
    .catch((e: unknown) => {
      console.warn('[rrcNickPersist] upsert failed ' + errLikeToLogString(e));
    });
}
