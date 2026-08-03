import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  MAX_RETICULUM_IDENTITY_DESTINATIONS,
  trimMapToMaxSize,
} from '@/renderer/lib/sessionMemoryCaps';

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

const ACTIVITY_BATCH_FLUSH_MS = 500;
const ACTIVITY_BATCH_MAX = 50;
/** Cap pending unknown-aspect rows while announce-bus pressure is active. */
const ACTIVITY_STORM_UNKNOWN_PENDING_MAX = 20;

let pendingActivityByKey = new Map<string, ReticulumIdentityActivityRow>();
let activityFlushTimer: ReturnType<typeof setTimeout> | null = null;
/** When true, skip/cap unknown-aspect SQLite activity writes (announce storms). */
let announceBusPressureActive = false;

/** Gate unknown identity-activity SQLite writes during announce-bus pressure. */
export function setReticulumAnnounceBusPressureActive(active: boolean): void {
  announceBusPressureActive = active;
  if (!active) return;
  // Drop excess unknown pending rows so IPC cannot backlog under pressure.
  if (pendingActivityByKey.size <= ACTIVITY_STORM_UNKNOWN_PENDING_MAX) return;
  const next = new Map<string, ReticulumIdentityActivityRow>();
  for (const [key, row] of pendingActivityByKey) {
    if (row.aspect === 'unknown') continue;
    next.set(key, row);
  }
  // Keep a small unknown sample if space remains.
  let unknownKept = 0;
  for (const [key, row] of pendingActivityByKey) {
    if (row.aspect !== 'unknown') continue;
    if (unknownKept >= ACTIVITY_STORM_UNKNOWN_PENDING_MAX) break;
    next.set(key, row);
    unknownKept += 1;
  }
  pendingActivityByKey = next;
}

export function isReticulumAnnounceBusPressureActive(): boolean {
  return announceBusPressureActive;
}

function activityBatchKey(row: ReticulumIdentityActivityRow): string {
  return `${row.destination_hash}\0${row.aspect}`;
}

async function flushPendingActivity(): Promise<void> {
  activityFlushTimer = null;
  if (pendingActivityByKey.size === 0) return;
  const batch = [...pendingActivityByKey.values()];
  pendingActivityByKey = new Map();
  try {
    const api = window.electronAPI?.db;
    if (api?.upsertReticulumIdentityActivityBatch) {
      await api.upsertReticulumIdentityActivityBatch(batch);
    } else {
      for (const row of batch) {
        await api.upsertReticulumIdentityActivity(row);
      }
    }
  } catch (e) {
    console.warn('[reticulumIdentityActivityStore] batch upsert ' + errLikeToLogString(e));
  }
}

function scheduleActivityFlush(): void {
  if (activityFlushTimer != null) return;
  activityFlushTimer = setTimeout(() => {
    void flushPendingActivity();
  }, ACTIVITY_BATCH_FLUSH_MS);
}

/** Test helper — reset activity IPC batch buffer. */
export function resetReticulumIdentityActivityBatchForTests(): void {
  pendingActivityByKey = new Map();
  announceBusPressureActive = false;
  if (activityFlushTimer != null) {
    clearTimeout(activityFlushTimer);
    activityFlushTimer = null;
  }
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
          return { byDestination: trimMapToMaxSize(next, MAX_RETICULUM_IDENTITY_DESTINATIONS) };
        });
        return rows;
      } catch (e) {
        console.debug('[reticulumIdentityActivityStore] load ' + errLikeToLogString(e));
        return get().getActivity(key);
      }
    },

    upsertActivity: (row) => {
      const key = normalizeHash(row.destination_hash);
      const normalized: ReticulumIdentityActivityRow = {
        ...row,
        destination_hash: key,
        aspect: row.aspect.slice(0, 128),
      };
      // Announce storms: skip unknown-aspect SQLite writes; keep named aspects.
      if (announceBusPressureActive && normalized.aspect === 'unknown') {
        set((s) => {
          const next = new Map(s.byDestination);
          const prev = next.get(key) ?? [];
          const filtered = prev.filter((r) => r.aspect !== normalized.aspect);
          next.set(key, [normalized, ...filtered]);
          return { byDestination: trimMapToMaxSize(next, MAX_RETICULUM_IDENTITY_DESTINATIONS) };
        });
        return Promise.resolve();
      }
      pendingActivityByKey.set(activityBatchKey(normalized), normalized);
      if (pendingActivityByKey.size >= ACTIVITY_BATCH_MAX) {
        if (activityFlushTimer != null) {
          clearTimeout(activityFlushTimer);
          activityFlushTimer = null;
        }
        void flushPendingActivity();
      } else {
        scheduleActivityFlush();
      }
      set((s) => {
        const next = new Map(s.byDestination);
        const prev = next.get(key) ?? [];
        const filtered = prev.filter((r) => r.aspect !== normalized.aspect);
        next.set(key, [normalized, ...filtered]);
        return { byDestination: trimMapToMaxSize(next, MAX_RETICULUM_IDENTITY_DESTINATIONS) };
      });
      return Promise.resolve();
    },

    getActivity: (destinationHash) => {
      return get().byDestination.get(normalizeHash(destinationHash)) ?? [];
    },
  }),
);

function parseOneAnnounceActivityRow(p: Record<string, unknown>): ReticulumIdentityActivityRow[] {
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

/** Parse single-legacy or batched `{ announces: [...] }` announce.received payloads. */
export function parseAnnounceActivityRows(payload: unknown): ReticulumIdentityActivityRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.announces)) {
    const out: ReticulumIdentityActivityRow[] = [];
    for (const row of p.announces) {
      if (!row || typeof row !== 'object') continue;
      out.push(...parseOneAnnounceActivityRow(row as Record<string, unknown>));
    }
    return out;
  }
  return parseOneAnnounceActivityRow(p);
}
