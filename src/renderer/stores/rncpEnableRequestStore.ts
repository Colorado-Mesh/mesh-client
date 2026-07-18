import { create } from 'zustand';

export interface RncpEnableRequestPrompt {
  /** Sender LXMF delivery hash (32 hex). */
  peerHash: string;
  peerLabel: string | null;
  receivedAt: number;
}

interface RncpEnableRequestStoreState {
  /** Pending inbound enable prompts (newest last). */
  prompts: RncpEnableRequestPrompt[];
  /** Peers that chose "Don't ask again". */
  dismissedPeers: Set<string>;
  enqueue: (prompt: RncpEnableRequestPrompt) => void;
  dismiss: (peerHash: string, permanent: boolean) => void;
  clear: () => void;
}

function normalizeHash(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

export const useRncpEnableRequestStore = create<RncpEnableRequestStoreState>((set, get) => ({
  prompts: [],
  dismissedPeers: new Set(),

  enqueue: (prompt) => {
    const peerHash = normalizeHash(prompt.peerHash);
    if (peerHash.length !== 32) return;
    if (get().dismissedPeers.has(peerHash)) return;
    set((s) => {
      if (s.prompts.some((p) => p.peerHash === peerHash)) {
        return s;
      }
      return {
        prompts: [...s.prompts, { ...prompt, peerHash }],
      };
    });
  },

  dismiss: (peerHash, permanent) => {
    const key = normalizeHash(peerHash);
    set((s) => {
      const dismissedPeers = permanent ? new Set([...s.dismissedPeers, key]) : s.dismissedPeers;
      return {
        prompts: s.prompts.filter((p) => p.peerHash !== key),
        dismissedPeers,
      };
    });
  },

  clear: () => {
    set({ prompts: [] });
  },
}));
