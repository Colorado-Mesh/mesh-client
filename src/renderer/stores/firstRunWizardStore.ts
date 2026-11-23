import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { FIRST_RUN_WIZARD_STORAGE_KEY, type FirstRunStatus } from '@/renderer/lib/firstRunWizard';
import type { MeshProtocol } from '@/shared/meshProtocol';

interface FirstRunWizardState {
  /** Persisted progress; see `FirstRunStatus`. */
  status: FirstRunStatus;
  pickerOpen: boolean;
  /** Protocols the setup tour walks through, or `null` when no tour is running. */
  tour: MeshProtocol[] | null;
  tourStep: number;
  /** Shows the picker and marks the wizard pending, so quitting brings it back. */
  openPicker: () => void;
  /** Ends the wizard for good without a tour. */
  skip: () => void;
  /** Ends the picker for good and starts the tour over `protocols`. */
  startTour: (protocols: MeshProtocol[]) => void;
  /** Moves to the next tour step; past the last step the tour ends. */
  nextTourStep: () => void;
  endTour: () => void;
}

function isFirstRunStatus(value: unknown): value is FirstRunStatus {
  return value === 'unseen' || value === 'pending' || value === 'done';
}

/** Drop corrupted localStorage so persist still finishes hydration with defaults. */
export function createFirstRunWizardPersistStorage(): StateStorage {
  return {
    getItem: (name) => {
      try {
        const raw = localStorage.getItem(name);
        if (raw == null) return null;
        JSON.parse(raw);
        return raw;
      } catch (err) {
        console.warn(
          'mcL1408 [FirstRunWizardStore] malformed persisted state — resetting ' +
            errLikeToLogString(err),
        );
        localStorage.removeItem(name);
        return null;
      }
    },
    setItem: (name, value) => {
      localStorage.setItem(name, value);
    },
    removeItem: (name) => {
      localStorage.removeItem(name);
    },
  };
}

export const useFirstRunWizardStore = create<FirstRunWizardState>()(
  persist(
    (set) => ({
      status: 'unseen',
      pickerOpen: false,
      tour: null,
      tourStep: 0,
      openPicker: () => {
        set((s) => (s.status === 'done' ? s : { status: 'pending', pickerOpen: true }));
      },
      skip: () => {
        set({ status: 'done', pickerOpen: false, tour: null, tourStep: 0 });
      },
      startTour: (protocols) => {
        set({
          status: 'done',
          pickerOpen: false,
          tour: protocols.length > 0 ? [...protocols] : null,
          tourStep: 0,
        });
      },
      nextTourStep: () => {
        set((s) => {
          if (!s.tour) return s;
          const next = s.tourStep + 1;
          return next < s.tour.length ? { tourStep: next } : { tour: null, tourStep: 0 };
        });
      },
      endTour: () => {
        set({ tour: null, tourStep: 0 });
      },
    }),
    {
      name: FIRST_RUN_WIZARD_STORAGE_KEY,
      storage: createJSONStorage(() => createFirstRunWizardPersistStorage()),
      // A restart ends an unfinished tour; only the progress marker survives.
      partialize: (state) => ({ status: state.status }),
      merge: (persisted, current) => {
        const status = (persisted as { status?: unknown } | undefined)?.status;
        if (isFirstRunStatus(status)) {
          return { ...current, status };
        }
        return current;
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn(
            'mcL1409 [FirstRunWizardStore] rehydrate failed — using defaults ' +
              errLikeToLogString(error),
          );
        }
      },
    },
  ),
);
