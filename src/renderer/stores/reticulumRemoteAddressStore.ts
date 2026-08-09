import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { RemoteAddressBookRow, UpsertRemoteAddressRequest } from '@/shared/remote-types';

interface ReticulumRemoteAddressStoreState {
  addresses: Map<string, RemoteAddressBookRow>;
  hydrated: boolean;
  loading: boolean;
  /** In-flight fetch, so concurrent callers chain instead of reading stale data. */
  loadingPromise: Promise<void> | null;
  hydrate: () => Promise<void>;
  upsert: (row: UpsertRemoteAddressRequest) => Promise<RemoteAddressBookRow | null>;
  remove: (id: string) => Promise<void>;
  findByDestination: (
    destinationHash: string,
    service?: RemoteAddressBookRow['service'],
  ) => RemoteAddressBookRow | undefined;
  findByLxmfPeer: (lxmfPeerHash: string) => RemoteAddressBookRow | undefined;
  clear: () => void;
}

// Bumped by clear() so an in-flight hydrate() cannot restore cleared state after its
// listReticulumRemoteAddresses() promise resolves late (module-level to avoid re-renders).
let clearGeneration = 0;

export const useReticulumRemoteAddressStore = create<ReticulumRemoteAddressStoreState>(
  (set, get) => ({
    addresses: new Map(),
    hydrated: false,
    loading: false,
    loadingPromise: null,

    hydrate: async () => {
      // Chain onto any in-flight fetch so a hydrate requested after a write always runs
      // once the current one settles. Early-returning stale data would drop a just-upserted
      // row and surface to callers as upsert_failed (concurrent RNCP receive-dest shares).
      const prior = get().loadingPromise ?? Promise.resolve();
      const run = async (): Promise<void> => {
        // Snapshot the clear-generation so a clear() during the awaited IPC drops this write.
        const gen = clearGeneration;
        set({ loading: true });
        try {
          const rows = await window.electronAPI.db.listReticulumRemoteAddresses();
          if (gen !== clearGeneration) return;
          const map = new Map<string, RemoteAddressBookRow>();
          for (const row of rows) {
            map.set(row.id, row);
          }
          set({ addresses: map, hydrated: true, loading: false });
        } catch (e) {
          console.warn('[reticulumRemoteAddressStore] hydrate ' + errLikeToLogString(e));
          if (gen === clearGeneration) set({ loading: false });
        }
      };
      const p = prior.then(run);
      set({ loadingPromise: p });
      void p.finally(() => {
        if (get().loadingPromise === p) set({ loadingPromise: null });
      });
      return p;
    },

    upsert: async (row) => {
      try {
        await window.electronAPI.db.upsertReticulumRemoteAddress(row);
        // Server generates the id/timestamps on insert — refresh from DB rather than guess them.
        await get().hydrate();
        const key = row.destination_hash.toLowerCase();
        return (
          [...get().addresses.values()].find(
            (a) => a.destination_hash === key && a.service === row.service,
          ) ?? null
        );
      } catch (e) {
        console.warn('[reticulumRemoteAddressStore] upsert ' + errLikeToLogString(e));
        return null;
      }
    },

    remove: async (id) => {
      try {
        await window.electronAPI.db.deleteReticulumRemoteAddress(id);
        set((s) => {
          const addresses = new Map(s.addresses);
          addresses.delete(id);
          return { addresses };
        });
      } catch (e) {
        console.warn('[reticulumRemoteAddressStore] remove ' + errLikeToLogString(e));
      }
    },

    findByDestination: (destinationHash, service) => {
      const key = destinationHash.trim().toLowerCase();
      for (const row of get().addresses.values()) {
        if (row.destination_hash.toLowerCase() !== key) continue;
        if (service && row.service !== service) continue;
        return row;
      }
      return undefined;
    },

    findByLxmfPeer: (lxmfPeerHash) => {
      const key = lxmfPeerHash.trim().toLowerCase();
      for (const row of get().addresses.values()) {
        if (row.lxmf_peer_hash?.toLowerCase() === key) return row;
      }
      return undefined;
    },

    clear: () => {
      clearGeneration += 1;
      set({ addresses: new Map(), hydrated: false, loading: false, loadingPromise: null });
    },
  }),
);
