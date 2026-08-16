import { create } from 'zustand';

export type VoiceMemoPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'sending' | 'error';

interface ReticulumVoiceMemoStoreState {
  phase: VoiceMemoPhase;
  sessionId: string | null;
  /** Duration of the recorded memo in milliseconds (from sidecar stop response). */
  durationMs: number | null;
  /** Recorded Ogg bytes as base64 (available after stop). */
  oggBase64: string | null;
  /** Byte count of Ogg data. */
  sizeBytes: number | null;
  /** Human-readable error for toast display. */
  lastError: string | null;
  /** Elapsed recording seconds (updated by the recorder). */
  elapsedSec: number;

  startRecording: (sessionId: string) => void;
  setStarting: () => void;
  setStopping: () => void;
  setSending: () => void;
  applyStopResult: (opts: { oggBase64: string; durationMs: number; sizeBytes: number }) => void;
  setError: (message: string) => void;
  reset: () => void;
  tickElapsed: (sec: number) => void;
}

const IDLE_STATE: Pick<
  ReticulumVoiceMemoStoreState,
  'phase' | 'sessionId' | 'durationMs' | 'oggBase64' | 'sizeBytes' | 'lastError' | 'elapsedSec'
> = {
  phase: 'idle',
  sessionId: null,
  durationMs: null,
  oggBase64: null,
  sizeBytes: null,
  lastError: null,
  elapsedSec: 0,
};

export const useReticulumVoiceMemoStore = create<ReticulumVoiceMemoStoreState>((set) => ({
  ...IDLE_STATE,

  setStarting: () => {
    set({ phase: 'starting', lastError: null, elapsedSec: 0 });
  },

  startRecording: (sessionId) => {
    set({ phase: 'recording', sessionId, lastError: null, elapsedSec: 0 });
  },

  setStopping: () => {
    set({ phase: 'stopping' });
  },

  setSending: () => {
    set({ phase: 'sending' });
  },

  applyStopResult: ({ oggBase64, durationMs, sizeBytes }) => {
    set({ oggBase64, durationMs, sizeBytes });
  },

  setError: (message) => {
    set({ phase: 'error', lastError: message });
  },

  reset: () => {
    set(IDLE_STATE);
  },

  tickElapsed: (sec) => {
    set({ elapsedSec: sec });
  },
}));
