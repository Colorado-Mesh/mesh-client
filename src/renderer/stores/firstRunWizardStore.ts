import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
      // A restart ends an unfinished tour; only the progress marker survives.
      partialize: (state) => ({ status: state.status }),
    },
  ),
);
