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
  /** Re-key coverage when an outbound message id is renamed (e.g. Meshtastic tempId → wire id). */
  renameMessage: (identityId: IdentityId, fromMessageId: string, toMessageId: string) => void;
}

export function relayCoverageKey(identityId: IdentityId, messageId: string): string {
  return `${identityId}:${messageId}`;
}

export const useRelayCoverageStore = create<RelayCoverageState>()((set, get) => ({
  coverage: {},
  set: (identityId, messageId, patch) => {
    set((s) => {
      const k = relayCoverageKey(identityId, messageId);
      const prev = s.coverage[k];
      return {
        coverage: {
          ...s.coverage,
          [k]: {
            ...prev,
            ...patch,
            updatedAt: Date.now(),
          },
        },
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
  renameMessage: (identityId, fromMessageId, toMessageId) => {
    if (fromMessageId === toMessageId) return;
    set((s) => {
      const fromKey = relayCoverageKey(identityId, fromMessageId);
      const toKey = relayCoverageKey(identityId, toMessageId);
      if (!Object.hasOwn(s.coverage, fromKey)) return s;
      const entry = s.coverage[fromKey];
      const next: Record<string, RelayCoverage> = {};
      for (const [k, v] of Object.entries(s.coverage)) {
        if (k !== fromKey) next[k] = v;
      }
      next[toKey] = { ...entry, updatedAt: Date.now() };
      return { coverage: next };
    });
  },
}));
