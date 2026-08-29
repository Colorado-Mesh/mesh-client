import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { normalizeBlockedHash } from '@/shared/blockedContactHash';
import type { MeshProtocol } from '@/shared/meshProtocol';

/** Row metadata for the blocked-contacts list view. */
export interface BlockedContactEntry {
  hash: string;
  createdAt: number;
}

interface BlockStoreState {
  protocol: MeshProtocol | null;
  identityId: string | null;
  /** Hot lookup set for the inbound LXMF ingest filter. */
  blockedHashes: Set<string>;
  /** Parallel metadata for the list view, newest first. `isBlocked` never reads this. */
  blockedEntries: BlockedContactEntry[];
  loaded: boolean;
  load: (protocol: MeshProtocol, identityId: string) => Promise<void>;
  block: (protocol: MeshProtocol, identityId: string, blockedHash: string) => Promise<void>;
  unblock: (protocol: MeshProtocol, identityId: string, blockedHash: string) => Promise<void>;
  isBlocked: (blockedHash: string) => boolean;
}

export const useBlockStore = create<BlockStoreState>((set, get) => ({
  protocol: null,
  identityId: null,
  blockedHashes: new Set(),
  blockedEntries: [],
  loaded: false,

  load: async (protocol, identityId) => {
    try {
      const rows = await window.electronAPI.db.getBlockedContacts(protocol, identityId);
      const blockedEntries = rows.map((r) => ({
        hash: normalizeBlockedHash(r.blocked_hash),
        createdAt: r.created_at,
      }));
      const blockedHashes = new Set(blockedEntries.map((e) => e.hash));
      set({ protocol, identityId, blockedHashes, blockedEntries, loaded: true });
    } catch (e) {
      console.warn('[blockStore] load ' + errLikeToLogString(e));
      set({
        protocol,
        identityId,
        blockedHashes: new Set(),
        blockedEntries: [],
        loaded: true,
      });
    }
  },

  block: async (protocol, identityId, blockedHash) => {
    const normalized = normalizeBlockedHash(blockedHash);
    try {
      await window.electronAPI.db.blockContact(protocol, identityId, normalized);
      set((s) => {
        const next = new Set(s.blockedHashes);
        next.add(normalized);
        const entries = s.blockedEntries.some((e) => e.hash === normalized)
          ? s.blockedEntries
          : [{ hash: normalized, createdAt: Date.now() }, ...s.blockedEntries];
        return {
          blockedHashes: next,
          blockedEntries: entries,
          protocol,
          identityId,
          loaded: true,
        };
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
      set((s) => {
        const next = new Set(s.blockedHashes);
        next.delete(normalized);
        return {
          blockedHashes: next,
          blockedEntries: s.blockedEntries.filter((e) => e.hash !== normalized),
        };
      });
    } catch (e) {
      console.warn('[blockStore] unblock ' + errLikeToLogString(e));
      throw e;
    }
  },

  isBlocked: (blockedHash) => {
    return get().blockedHashes.has(normalizeBlockedHash(blockedHash));
  },
}));

/**
 * Identity whose blocklist the Reticulum UI should show, or `null`.
 *
 * The store holds one protocol at a time and only `useReticulumRuntime` hydrates
 * it, so the scope check lives here rather than in each consuming component.
 */
export function useReticulumBlocklistIdentityId(): string | null {
  return useBlockStore((s) => (s.protocol === 'reticulum' ? s.identityId : null));
}
