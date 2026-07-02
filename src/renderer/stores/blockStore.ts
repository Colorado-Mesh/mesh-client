import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { MeshProtocol } from '@/shared/meshProtocol';

function normalizeBlockedHash(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase() || hash.trim().toLowerCase();
}

interface BlockStoreState {
  protocol: MeshProtocol | null;
  identityId: string | null;
  blockedHashes: Set<string>;
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
  loaded: false,

  load: async (protocol, identityId) => {
    try {
      const rows = await window.electronAPI.db.getBlockedContacts(protocol, identityId);
      const blockedHashes = new Set(rows.map((r) => normalizeBlockedHash(r.blocked_hash)));
      set({ protocol, identityId, blockedHashes, loaded: true });
    } catch (e) {
      console.warn('[blockStore] load ' + errLikeToLogString(e));
      set({ protocol, identityId, blockedHashes: new Set(), loaded: true });
    }
  },

  block: async (protocol, identityId, blockedHash) => {
    const normalized = normalizeBlockedHash(blockedHash);
    try {
      await window.electronAPI.db.blockContact(protocol, identityId, normalized);
      set((s) => {
        const next = new Set(s.blockedHashes);
        next.add(normalized);
        return { blockedHashes: next, protocol, identityId, loaded: true };
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
        return { blockedHashes: next };
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

/** Node id string for Meshtastic/MeshCore block rows. */
export function blockHashForNodeNum(nodeNum: number): string {
  return String(nodeNum);
}
