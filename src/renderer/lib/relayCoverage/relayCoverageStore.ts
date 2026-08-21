import { create } from 'zustand';

import type { IdentityId } from '@/renderer/lib/types';

export type RelayCoverageMode = 'confirmed' | 'binary-heard' | 'predicted';

export interface HeardRepeater {
  nodeId: number;
  name?: string;
  snr?: number;
  rssi?: number;
}

export interface RelayCoverage {
  protocol: 'meshcore' | 'meshtastic' | 'reticulum';
  mode: RelayCoverageMode;
  heardRepeaters?: HeardRepeater[];
  /** Meshtastic: true=heard, false=timeout, null=pending */
  broadcastHeard?: boolean | null;
  predictedRelayHops?: number;
  predictedFirstHop?: string;
  updatedAt: number;
}

export type RelayCoveragePatch = Partial<Omit<RelayCoverage, 'updatedAt'>> &
  Pick<RelayCoverage, 'protocol' | 'mode'>;

interface RelayCoverageState {
  coverage: Record<string, RelayCoverage>;
  set: (identityId: IdentityId, messageId: string, patch: RelayCoveragePatch) => void;
  coverageFor: (identityId: IdentityId, messageId: string) => RelayCoverage | undefined;
  clearIdentity: (identityId: IdentityId) => void;
  /** Drop a single message's coverage (failed / abandoned send). */
  remove: (identityId: IdentityId, messageId: string) => void;
  /** Re-key coverage when an outbound message id is renamed (e.g. Meshtastic tempId → wire id). */
  renameMessage: (identityId: IdentityId, fromMessageId: string, toMessageId: string) => void;
}

export function relayCoverageKey(identityId: IdentityId, messageId: string): string {
  return `${identityId}:${messageId}`;
}

/**
 * Soft cap for in-memory coverage rows. When exceeded on `set`, drop oldest-by-updatedAt
 * entries (always retaining the key being written). Avoids unbounded growth on long sessions
 * without paying O(n) on every small write.
 */
export const RELAY_COVERAGE_SOFT_CAP = 256;

function pruneOldestCoverageEntries(
  coverage: Record<string, RelayCoverage>,
  keepKey: string,
  softCap: number,
): Record<string, RelayCoverage> {
  const keys = Object.keys(coverage);
  if (keys.length <= softCap) return coverage;
  const ranked = keys
    .map((k) => ({ k, updatedAt: coverage[k].updatedAt }))
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const drop = new Set<string>();
  let excess = keys.length - softCap;
  for (const { k } of ranked) {
    if (excess <= 0) break;
    if (k === keepKey) continue;
    drop.add(k);
    excess -= 1;
  }
  if (drop.size === 0) return coverage;
  const next: Record<string, RelayCoverage> = {};
  for (const [k, v] of Object.entries(coverage)) {
    if (!drop.has(k)) next[k] = v;
  }
  return next;
}

export const useRelayCoverageStore = create<RelayCoverageState>()((set, get) => ({
  coverage: {},
  set: (identityId, messageId, patch) => {
    set((s) => {
      const k = relayCoverageKey(identityId, messageId);
      let base: Partial<RelayCoverage> = {};
      if (Object.hasOwn(s.coverage, k)) {
        const prev = s.coverage[k];
        const modeChanged = prev.protocol !== patch.protocol || prev.mode !== patch.mode;
        if (!modeChanged) base = prev;
      }
      const entry: RelayCoverage = {
        ...base,
        ...patch,
        updatedAt: Date.now(),
      };
      const withEntry: Record<string, RelayCoverage> = {
        ...s.coverage,
        [k]: entry,
      };
      return {
        coverage: pruneOldestCoverageEntries(withEntry, k, RELAY_COVERAGE_SOFT_CAP),
      };
    });
  },
  coverageFor: (identityId, messageId) => get().coverage[relayCoverageKey(identityId, messageId)],
  clearIdentity: (identityId) => {
    set((s) => {
      const prefix = `${identityId}:`;
      const next: Record<string, RelayCoverage> = {};
      for (const [k, v] of Object.entries(s.coverage)) {
        if (!k.startsWith(prefix)) next[k] = v;
      }
      return { coverage: next };
    });
  },
  remove: (identityId, messageId) => {
    set((s) => {
      const k = relayCoverageKey(identityId, messageId);
      if (!Object.hasOwn(s.coverage, k)) return s;
      const next: Record<string, RelayCoverage> = {};
      for (const [key, v] of Object.entries(s.coverage)) {
        if (key !== k) next[key] = v;
      }
      return { coverage: next };
    });
  },
  renameMessage: (identityId, fromMessageId, toMessageId) => {
    if (fromMessageId === toMessageId) return;
    set((s) => {
      const fromKey = relayCoverageKey(identityId, fromMessageId);
      const toKey = relayCoverageKey(identityId, toMessageId);
      if (!Object.hasOwn(s.coverage, fromKey)) return s;
      const fromEntry = s.coverage[fromKey];
      const toEntry = Object.hasOwn(s.coverage, toKey) ? s.coverage[toKey] : undefined;
      const next: Record<string, RelayCoverage> = {};
      for (const [k, v] of Object.entries(s.coverage)) {
        if (k !== fromKey) next[k] = v;
      }
      if (toEntry != null) {
        const byId = new Map<number, HeardRepeater>();
        for (const r of toEntry.heardRepeaters ?? []) byId.set(r.nodeId, r);
        for (const r of fromEntry.heardRepeaters ?? []) {
          if (!byId.has(r.nodeId)) byId.set(r.nodeId, r);
        }
        next[toKey] = {
          ...fromEntry,
          ...toEntry,
          ...(toEntry.mode === 'confirmed' || fromEntry.mode === 'confirmed'
            ? { heardRepeaters: [...byId.values()] }
            : {}),
          updatedAt: Date.now(),
        };
      } else {
        next[toKey] = { ...fromEntry, updatedAt: Date.now() };
      }
      return { coverage: next };
    });
  },
}));
