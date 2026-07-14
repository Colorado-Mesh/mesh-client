import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumRawPacketEntry } from '@/renderer/lib/rawPacketLogConstants';
import { reticulumWireRowToEntry } from '@/renderer/lib/reticulum/reticulumRawPacketLog';
import type { ReticulumWirePacketRow } from '@/shared/reticulum-types';

export const RETICULUM_PACKET_RING_CAPACITY = 500;

interface ReticulumPacketStoreState {
  packets: ReticulumRawPacketEntry[];
  appendPacket: (entry: ReticulumRawPacketEntry) => void;
  appendPackets: (entries: ReticulumRawPacketEntry[]) => void;
  replacePackets: (entries: ReticulumRawPacketEntry[]) => void;
  clearPackets: () => void;
  hydrateFromSidecar: () => Promise<void>;
  clearSidecarBuffer: () => Promise<void>;
}

function trimRingBuffer(entries: ReticulumRawPacketEntry[]): ReticulumRawPacketEntry[] {
  if (entries.length <= RETICULUM_PACKET_RING_CAPACITY) return entries;
  return entries.slice(-RETICULUM_PACKET_RING_CAPACITY);
}

let pendingPackets: ReticulumRawPacketEntry[] = [];
let packetFlushScheduled = false;
let packetRafId: number | null = null;

function flushPendingPackets(): void {
  packetFlushScheduled = false;
  packetRafId = null;
  if (pendingPackets.length === 0) return;
  const batch = pendingPackets;
  pendingPackets = [];
  useReticulumPacketStore.setState((s) => ({
    packets: trimRingBuffer([...s.packets, ...batch]),
  }));
}

export function resetReticulumPacketBatchForTests(): void {
  pendingPackets = [];
  packetFlushScheduled = false;
  if (packetRafId != null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(packetRafId);
  }
  packetRafId = null;
}

export const useReticulumPacketStore = create<ReticulumPacketStoreState>((set, get) => ({
  packets: [],

  appendPacket: (entry) => {
    pendingPackets.push(entry);
    if (packetFlushScheduled) return;
    packetFlushScheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      packetRafId = requestAnimationFrame(() => {
        flushPendingPackets();
      });
    } else {
      flushPendingPackets();
    }
  },

  appendPackets: (entries) => {
    if (entries.length === 0) return;
    set((s) => ({ packets: trimRingBuffer([...s.packets, ...entries]) }));
  },

  replacePackets: (entries) => {
    set({ packets: trimRingBuffer(entries) });
  },

  clearPackets: () => {
    pendingPackets = [];
    packetFlushScheduled = false;
    if (packetRafId != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(packetRafId);
    }
    packetRafId = null;
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
