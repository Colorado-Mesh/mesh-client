import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { removeRendererStorageItem, setRendererStorageItem } from '@/renderer/lib/rendererStorage';

interface WatchedNodesState {
  watchedNodeIds: Set<number>;
  toggleWatch: (nodeId: number) => void;
}

export const useWatchedNodesStore = create<WatchedNodesState>()(
  persist(
    (set) => ({
      watchedNodeIds: new Set<number>(),
      toggleWatch: (nodeId) =>
        set((state) => {
          const next = new Set(state.watchedNodeIds);
          if (next.has(nodeId)) {
            next.delete(nodeId);
          } else {
            next.add(nodeId);
          }
          return { watchedNodeIds: next };
        }),
    }),
    {
      name: 'mesh-client:watchedNodes',
      storage: {
        getItem: (key) => {
          const raw = localStorage.getItem(key);
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as { state?: { watchedNodeIds?: number[] } };
            const ids = parsed?.state?.watchedNodeIds;
            if (Array.isArray(ids)) {
              return { ...parsed, state: { watchedNodeIds: new Set<number>(ids) } };
            }
          } catch {
            // catch-no-log-ok: invalid persisted data, fall through to null
          }
          return null;
        },
        setItem: (key, value) => {
          const serialized = {
            ...value,
            state: {
              ...value.state,
              watchedNodeIds: [...value.state.watchedNodeIds],
            },
          };
          setRendererStorageItem(key, JSON.stringify(serialized));
        },
        removeItem: (key) => {
          removeRendererStorageItem(key);
        },
      },
    },
  ),
);
