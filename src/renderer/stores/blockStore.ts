import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { normalizeBlockedHash } from '@/shared/blockedContactHash';
import type { MeshProtocol } from '@/shared/meshProtocol';

/** Row metadata for the blocked-contacts list view. */
export interface BlockedContactEntry {
  hash: string;
  createdAt: number;
}

/** One protocol's blocklist for its active identity. */
export interface ProtocolBlocklist {
  identityId: string;
  /** Hot lookup set for the inbound ingest filter. */
  hashes: Set<string>;
  /** Parallel metadata for the list view, newest first. `isBlocked` never reads this. */
  entries: BlockedContactEntry[];
  loaded: boolean;
}

interface BlockStoreState {
  /**
   * Reticulum blocks LXMF hashes; Meshtastic blocks decimal node ids; MeshCore blocks contact
   * pubkey hex (DMs) or node ids. Each protocol hydrates its own bucket on identity resolve.
   */
  byProtocol: Partial<Record<MeshProtocol, ProtocolBlocklist>>;
  load: (protocol: MeshProtocol, identityId: string) => Promise<void>;
  block: (protocol: MeshProtocol, identityId: string, blockedHash: string) => Promise<void>;
  unblock: (protocol: MeshProtocol, identityId: string, blockedHash: string) => Promise<void>;
  isBlocked: (blockedHash: string, protocol: MeshProtocol) => boolean;
}

const EMPTY_ENTRIES: BlockedContactEntry[] = [];

/** Bumped by block/unblock so an in-flight `load` can tell its DB snapshot went stale. */
const mutationVersion = new Map<MeshProtocol, number>();
const MAX_LOAD_ATTEMPTS = 3;

function bumpMutationVersion(protocol: MeshProtocol): void {
  mutationVersion.set(protocol, (mutationVersion.get(protocol) ?? 0) + 1);
}

export const useBlockStore = create<BlockStoreState>((set, get) => ({
  byProtocol: {},

  load: async (protocol, identityId) => {
    for (let attempt = 1; ; attempt++) {
      const startVersion = mutationVersion.get(protocol) ?? 0;
      let next: ProtocolBlocklist;
      try {
        const rows = await window.electronAPI.db.getBlockedContacts(protocol, identityId);
        const entries = rows.map((r) => ({
          hash: normalizeBlockedHash(r.blocked_hash),
          createdAt: r.created_at,
        }));
        next = { identityId, hashes: new Set(entries.map((e) => e.hash)), entries, loaded: true };
      } catch (e) {
        console.warn('[blockStore] load ' + errLikeToLogString(e));
        next = { identityId, hashes: new Set(), entries: [], loaded: true };
      }
      // Mutations persist to the DB before updating state, so a re-read picks them up.
      if ((mutationVersion.get(protocol) ?? 0) !== startVersion && attempt < MAX_LOAD_ATTEMPTS) {
        continue;
      }
      set((s) => ({ byProtocol: { ...s.byProtocol, [protocol]: next } }));
      return;
    }
  },

  block: async (protocol, identityId, blockedHash) => {
    const normalized = normalizeBlockedHash(blockedHash);
    try {
      await window.electronAPI.db.blockContact(protocol, identityId, normalized);
      bumpMutationVersion(protocol);
      set((s) => {
        const prev = s.byProtocol[protocol];
        const base: ProtocolBlocklist =
          prev?.identityId === identityId
            ? prev
            : { identityId, hashes: new Set(), entries: [], loaded: true };
        const hashes = new Set(base.hashes);
        hashes.add(normalized);
        const entries = base.entries.some((e) => e.hash === normalized)
          ? base.entries
          : [{ hash: normalized, createdAt: Date.now() }, ...base.entries];
        return { byProtocol: { ...s.byProtocol, [protocol]: { ...base, hashes, entries } } };
      });
    } catch (e) {
      console.warn('[blockStore] block ' + errLikeToLogString(e));
      throw e;
    }
  },

  unblock: async (protocol, identityId, blockedHash) => {
    const normalized = normalizeBlockedHash(blockedHash);
    try {
      await window.electronAPI.db.unblockContact(protocol, identityId, normalized);
      bumpMutationVersion(protocol);
      set((s) => {
        const prev = s.byProtocol[protocol];
        if (prev?.identityId !== identityId) return s;
        const hashes = new Set(prev.hashes);
        hashes.delete(normalized);
        return {
          byProtocol: {
            ...s.byProtocol,
            [protocol]: {
              ...prev,
              hashes,
              entries: prev.entries.filter((e) => e.hash !== normalized),
            },
          },
        };
      });
    } catch (e) {
      console.warn('[blockStore] unblock ' + errLikeToLogString(e));
      throw e;
    }
  },

  isBlocked: (blockedHash, protocol) => {
    return get().byProtocol[protocol]?.hashes.has(normalizeBlockedHash(blockedHash)) ?? false;
  },
}));

/** Identity whose blocklist is loaded for `protocol`, or `null`. */
export function useBlocklistIdentityId(protocol: MeshProtocol): string | null {
  return useBlockStore((s) => s.byProtocol[protocol]?.identityId ?? null);
}

/** Blocked list rows for `protocol`, newest first (stable empty ref when not loaded). */
export function useBlockedEntries(protocol: MeshProtocol): BlockedContactEntry[] {
  return useBlockStore((s) => s.byProtocol[protocol]?.entries ?? EMPTY_ENTRIES);
}
