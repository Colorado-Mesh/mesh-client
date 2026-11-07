import { create } from 'zustand';

import type {
  ScheduledBroadcastInput,
  ScheduledBroadcastRow,
} from '@/shared/scheduledBroadcastTypes';
import { SCHEDULED_BROADCAST_SLOT_COUNT } from '@/shared/scheduledBroadcastTypes';

interface ScheduledBroadcastsState {
  hydrated: boolean;
  slots: Record<number, ScheduledBroadcastRow | null>;
  hydrate: () => Promise<void>;
  save: (input: ScheduledBroadcastInput) => Promise<void>;
  remove: (slot: number) => Promise<void>;
  clearAll: () => Promise<void>;
  /** Scheduler-owned: apply nextDueAt/lastResult without re-saving config. */
  applyRuntimeState: (
    slot: number,
    patch: Pick<ScheduledBroadcastRow, 'nextDueAt' | 'lastResult' | 'lastAttemptAt'>,
  ) => void;
}

function emptySlots(): Record<number, ScheduledBroadcastRow | null> {
  const slots: Record<number, ScheduledBroadcastRow | null> = {};
  for (let i = 1; i <= SCHEDULED_BROADCAST_SLOT_COUNT; i++) slots[i] = null;
  return slots;
}

let hydration: Promise<void> | null = null;

export const useScheduledBroadcastsStore = create<ScheduledBroadcastsState>((set, get) => ({
  hydrated: false,
  slots: emptySlots(),

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydration) return hydration;
    const list = window.electronAPI?.db?.listScheduledBroadcasts;
    if (!list) {
      set({ hydrated: true });
      return;
    }
    hydration = (async () => {
      try {
        const rows = await list();
        const slots = emptySlots();
        for (const row of rows) {
          if (row.slot >= 1 && row.slot <= SCHEDULED_BROADCAST_SLOT_COUNT) {
            slots[row.slot] = row;
          }
        }
        set({ slots, hydrated: true });
      } catch (error) {
        console.warn('[scheduledBroadcasts] hydrate failed:', error);
        set({ hydrated: true });
      } finally {
        hydration = null;
      }
    })();
    return hydration;
  },

  save: async (input) => {
    try {
      const row = await window.electronAPI.db.saveScheduledBroadcast(input);
      set((s) => ({ slots: { ...s.slots, [row.slot]: row } }));
    } catch (error) {
      console.warn('[scheduledBroadcasts] save failed:', error);
      throw error;
    }
  },

  remove: async (slot) => {
    try {
      await window.electronAPI.db.deleteScheduledBroadcast(slot);
      set((s) => ({ slots: { ...s.slots, [slot]: null } }));
    } catch (error) {
      console.warn('[scheduledBroadcasts] delete failed:', error);
      throw error;
    }
  },

  clearAll: async () => {
    try {
      await window.electronAPI.db.clearScheduledBroadcasts();
      set({ slots: emptySlots() });
    } catch (error) {
      console.warn('[scheduledBroadcasts] clearAll failed:', error);
      throw error;
    }
  },

  applyRuntimeState: (slot, patch) => {
    set((s) => {
      const prev = s.slots[slot];
      if (!prev) return s;
      return {
        slots: {
          ...s.slots,
          [slot]: {
            ...prev,
            ...patch,
          },
        },
      };
    });
  },
}));

/** Await before mounting the scheduler. Safe to call repeatedly. */
export function hydrateScheduledBroadcastsStore(): Promise<void> {
  return useScheduledBroadcastsStore.getState().hydrate();
}

export function resetScheduledBroadcastsStoreForTests(): void {
  hydration = null;
  useScheduledBroadcastsStore.setState({
    hydrated: false,
    slots: emptySlots(),
  });
}
