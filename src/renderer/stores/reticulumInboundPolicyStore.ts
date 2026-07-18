import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type {
  RemoteInboundPolicyRow,
  UpsertRemoteInboundPolicyRequest,
} from '@/shared/remote-types';

interface ReticulumInboundPolicyStoreState {
  policies: Map<string, RemoteInboundPolicyRow>;
  hydrated: boolean;
  loading: boolean;
  hydrate: () => Promise<void>;
  upsert: (row: UpsertRemoteInboundPolicyRequest) => Promise<void>;
  remove: (identityHash: string) => Promise<void>;
  decisionFor: (identityHash: string) => RemoteInboundPolicyRow['decision'] | undefined;
  clear: () => void;
}

export const useReticulumInboundPolicyStore = create<ReticulumInboundPolicyStoreState>(
  (set, get) => ({
    policies: new Map(),
    hydrated: false,
    loading: false,

    hydrate: async () => {
      if (get().loading) return;
      set({ loading: true });
      try {
        const rows = await window.electronAPI.db.listReticulumInboundPolicy();
        const map = new Map<string, RemoteInboundPolicyRow>();
        for (const row of rows) {
          map.set(row.identity_hash.toLowerCase(), row);
        }
        set({ policies: map, hydrated: true, loading: false });
      } catch (e) {
        console.warn('[reticulumInboundPolicyStore] hydrate ' + errLikeToLogString(e));
        set({ loading: false });
      }
    },

    upsert: async (row) => {
      const key = row.identity_hash.toLowerCase();
      try {
        await window.electronAPI.db.upsertReticulumInboundPolicy(row);
        set((s) => {
          const policies = new Map(s.policies);
          const existing = policies.get(key);
          const now = Date.now();
          policies.set(key, {
            identity_hash: key,
            decision: row.decision,
            label: row.label ?? existing?.label ?? null,
            auto_save_dir: row.auto_save_dir ?? existing?.auto_save_dir ?? null,
            created_at: existing?.created_at ?? now,
            updated_at: now,
          });
          return { policies };
        });
      } catch (e) {
        console.warn('[reticulumInboundPolicyStore] upsert ' + errLikeToLogString(e));
      }
    },

    remove: async (identityHash) => {
      const key = identityHash.toLowerCase();
      try {
        await window.electronAPI.db.deleteReticulumInboundPolicy(key);
        set((s) => {
          const policies = new Map(s.policies);
          policies.delete(key);
          return { policies };
        });
      } catch (e) {
        console.warn('[reticulumInboundPolicyStore] remove ' + errLikeToLogString(e));
      }
    },

    decisionFor: (identityHash) => get().policies.get(identityHash.toLowerCase())?.decision,

    clear: () => {
      set({ policies: new Map(), hydrated: false, loading: false });
    },
  }),
);
