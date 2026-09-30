import { create } from 'zustand';

/**
 * Per-session location confirmation state. Deliberately not persisted: every launch must
 * re-confirm a movable saved location (home vs. emergency operations center).
 */
interface LocationPromptState {
  /** Saved location id the user confirmed (or picked) this session. */
  confirmedLocationId: string | null;
  /** User dismissed the startup strip; the Diagnostics card still shows. */
  dismissedThisSession: boolean;
  /** A runtime finished at least one position resolve, so "no position" is a real answer. */
  positionResolved: boolean;
  confirmLocation(id: string): void;
  dismissForSession(): void;
  markPositionResolved(): void;
}

export const useLocationPromptStore = create<LocationPromptState>((set, get) => ({
  confirmedLocationId: null,
  dismissedThisSession: false,
  positionResolved: false,
  confirmLocation(id) {
    set({ confirmedLocationId: id });
  },
  dismissForSession() {
    set({ dismissedThisSession: true });
  },
  markPositionResolved() {
    if (!get().positionResolved) set({ positionResolved: true });
  },
}));
