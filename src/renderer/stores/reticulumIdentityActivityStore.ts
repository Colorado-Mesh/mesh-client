import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

export interface ReticulumIdentityActivityRow {
  destination_hash: string;
  aspect: string;
  identity_hash?: string | null;
  last_seen: number;
  hops?: number | null;
}

interface ReticulumIdentityActivityStoreState {
  byDestination: Map<string, ReticulumIdentityActivityRow[]>;
  loadForDestination: (destinationHash: string) => Promise<ReticulumIdentityActivityRow[]>;
  upsertActivity: (row: ReticulumIdentityActivityRow) => Promise<void>;
  getActivity: (destinationHash: string) => ReticulumIdentityActivityRow[];
}

function normalizeHash(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

export const useReticulumIdentityActivityStore = create<ReticulumIdentityActivityStoreState>(
  (set, get) => ({
    byDestination: new Map(),

    loadForDestination: async (destinationHash) => {
      const key = normalizeHash(destinationHash);
      try {
        const rows = (await window.electronAPI.db.getReticulumIdentityActivity(
          key,
        )) as ReticulumIdentityActivityRow[];
        set((s) => {
          const next = new Map(s.byDestination);
          next.set(key, rows);
          return { byDestination: next };
        });
        return rows;
      } catch (e) {
        console.debug('[reticulumIdentityActivityStore] load ' + errLikeToLogString(e));
        return get().getActivity(key);
      }
    },

    upsertActivity: async (row) => {
      const key = normalizeHash(row.destination_hash);
      const normalized: ReticulumIdentityActivityRow = {
        ...row,
        destination_hash: key,
        aspect: row.aspect.slice(0, 128),
      };
      try {
        await window.electronAPI.db.upsertReticulumIdentityActivity(normalized);
      } catch (e) {
        console.warn('[reticulumIdentityActivityStore] upsert ' + errLikeToLogString(e));
      }
      set((s) => {
        const next = new Map(s.byDestination);
        const prev = next.get(key) ?? [];
        const filtered = prev.filter((r) => r.aspect !== normalized.aspect);
        next.set(key, [normalized, ...filtered]);
        return { byDestination: next };
      });
    },

    getActivity: (destinationHash) => {
      return get().byDestination.get(normalizeHash(destinationHash)) ?? [];
    },
  }),
);

export function parseAnnounceActivityRows(payload: unknown): ReticulumIdentityActivityRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const destinationHash =
    typeof p.destination_hash === 'string'
      ? p.destination_hash
      : typeof p.hash === 'string'
        ? p.hash
        : null;
  if (!destinationHash) return [];
  const lastSeen =
    typeof p.last_seen === 'number'
      ? p.last_seen
      : typeof p.timestamp === 'number'
        ? p.timestamp
        : Date.now();
  const identityHash = typeof p.identity_hash === 'string' ? p.identity_hash : null;
  const hops = typeof p.hops === 'number' && Number.isFinite(p.hops) ? Math.trunc(p.hops) : null;
  const aspects: string[] = [];
  if (typeof p.aspect === 'string' && p.aspect.trim()) {
    aspects.push(p.aspect.trim());
  }
  if (Array.isArray(p.aspects)) {
    for (const a of p.aspects) {
      if (typeof a === 'string' && a.trim()) aspects.push(a.trim());
    }
  }
  if (aspects.length === 0) aspects.push('unknown');
  return aspects.map((aspect) => ({
    destination_hash: destinationHash,
    aspect,
    identity_hash: identityHash,
    last_seen: lastSeen,
    hops,
  }));
}
