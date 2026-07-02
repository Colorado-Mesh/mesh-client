import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumRawPacketEntry } from '@/renderer/lib/rawPacketLogConstants';
import { reticulumWireRowToEntry } from '@/renderer/lib/reticulum/reticulumRawPacketLog';
import type { ReticulumWirePacketRow } from '@/shared/reticulum-types';

export const RETICULUM_PACKET_RING_CAPACITY = 500;

interface ReticulumPacketStoreState {
  packets: ReticulumRawPacketEntry[];
  appendPacket: (entry: ReticulumRawPacketEntry) => void;
  replacePackets: (entries: ReticulumRawPacketEntry[]) => void;
  clearPackets: () => void;
  hydrateFromSidecar: () => Promise<void>;
  clearSidecarBuffer: () => Promise<void>;
}

function trimRingBuffer(entries: ReticulumRawPacketEntry[]): ReticulumRawPacketEntry[] {
  if (entries.length <= RETICULUM_PACKET_RING_CAPACITY) return entries;
  return entries.slice(-RETICULUM_PACKET_RING_CAPACITY);
}

export const useReticulumPacketStore = create<ReticulumPacketStoreState>((set, get) => ({
  packets: [],

  appendPacket: (entry) => {
    set((s) => ({ packets: trimRingBuffer([...s.packets, entry]) }));
  },

  replacePackets: (entries) => {
    set({ packets: trimRingBuffer(entries) });
  },

  clearPackets: () => {
    set({ packets: [] });
  },

  hydrateFromSidecar: async () => {
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/packets?limit=500')) as {
        packets?: ReticulumWirePacketRow[];
      };
      const entries = (body.packets ?? []).map(reticulumWireRowToEntry);
      get().replacePackets(entries);
    } catch (e) {
      console.debug('[reticulumPacketStore] hydrate ' + errLikeToLogString(e));
    }
  },

  clearSidecarBuffer: async () => {
    get().clearPackets();
    try {
      await window.electronAPI.reticulum.proxyDelete('/api/v1/packets');
    } catch (e) {
      console.debug('[reticulumPacketStore] clear sidecar ' + errLikeToLogString(e));
    }
  },
}));
