/**
 * Bounded, TTL-scoped "have I already handled this packet?" registry.
 *
 * Several ingress paths can observe the same wire packet: the Meshtastic SDK
 * dispatches `onMeshPacket` for every packet and then a second typed event for
 * the same payload, and Store & Forward routers re-send identical heartbeats.
 * Callers key by whatever identifies the packet (numeric id, `port:id`, a
 * content hash) and skip work when {@link PacketDedupeRegistry.markSeen}
 * reports the key was already recorded.
 *
 * Failure point: the registry is session memory only. Eviction is oldest-first
 * once `maxEntries` is exceeded, so a burst larger than the cap can let a late
 * duplicate through — callers must stay correct (not just efficient) in that
 * case.
 */

export interface PacketDedupeRegistryOptions {
  /** Entries older than this are treated as unseen. */
  ttlMs: number;
  /** Hard ceiling on retained keys; oldest are evicted first. */
  maxEntries: number;
}

export interface PacketDedupeRegistry {
  /** Records `key` and returns true when it was already present and unexpired. */
  markSeen(key: string | number, now?: number): boolean;
  /** True when `key` is present and unexpired, without recording it. */
  hasSeen(key: string | number, now?: number): boolean;
  clear(): void;
  /** Retained key count after pruning at `now`. Exposed for bounds assertions. */
  size(now?: number): number;
}

export function createPacketDedupeRegistry(
  options: PacketDedupeRegistryOptions,
): PacketDedupeRegistry {
  const ttlMs = Math.max(0, options.ttlMs);
  const maxEntries = Math.max(1, Math.floor(options.maxEntries));
  const seenAt = new Map<string, number>();

  const prune = (now: number): void => {
    for (const [key, recordedAt] of seenAt) {
      if (now - recordedAt >= ttlMs) seenAt.delete(key);
    }
    // Map iteration is insertion-ordered, so the first keys are the oldest.
    for (const key of seenAt.keys()) {
      if (seenAt.size <= maxEntries) break;
      seenAt.delete(key);
    }
  };

  const isFresh = (key: string, now: number): boolean => {
    const recordedAt = seenAt.get(key);
    return recordedAt !== undefined && now - recordedAt < ttlMs;
  };

  return {
    markSeen(key, now = Date.now()) {
      const stringKey = String(key);
      const alreadySeen = isFresh(stringKey, now);
      // Re-insert so a repeatedly seen key stays at the young end of the map.
      seenAt.delete(stringKey);
      seenAt.set(stringKey, now);
      prune(now);
      return alreadySeen;
    },
    hasSeen(key, now = Date.now()) {
      return isFresh(String(key), now);
    },
    clear() {
      seenAt.clear();
    },
    size(now = Date.now()) {
      prune(now);
      return seenAt.size;
    },
  };
}
