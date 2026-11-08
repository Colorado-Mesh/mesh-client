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
    opts?: ScheduledBroadcastRuntimePatchOptions,
  ) => void;
}

export interface ScheduledBroadcastRuntimePatchOptions {
  /**
   * `updatedAt` from the row the scheduler claimed. When the store row is newer,
   * keep that save's `nextDueAt` and only record the in-flight attempt.
   */
  expectedUpdatedAt?: number;
}

/**
 * Apply a scheduler attempt onto a slot. When `expectedUpdatedAt` does not match,
 * a newer save owns `nextDueAt` and only the attempt result is recorded.
 */
export function mergeScheduledBroadcastRuntimePatch(
  prev: ScheduledBroadcastRow,
  patch: Pick<ScheduledBroadcastRow, 'nextDueAt' | 'lastResult' | 'lastAttemptAt'>,
  opts?: ScheduledBroadcastRuntimePatchOptions,
): ScheduledBroadcastRow {
  const preserveNextDueAt =
    opts?.expectedUpdatedAt != null && prev.updatedAt !== opts.expectedUpdatedAt;
  return {
    ...prev,
    ...patch,
    ...(preserveNextDueAt ? { nextDueAt: prev.nextDueAt } : {}),
  };
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
        // Leave hydrated false and drop the in-flight promise so a later hydrate can retry.
        // A missing list API above stays terminal: there is no IPC to retry.
        console.warn('[scheduledBroadcasts] hydrate failed:', error);
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

  applyRuntimeState: (slot, patch, opts) => {
    set((s) => {
      const prev = s.slots[slot];
      if (!prev) return s;
      return {
        slots: {
          ...s.slots,
          [slot]: mergeScheduledBroadcastRuntimePatch(prev, patch, opts),
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
