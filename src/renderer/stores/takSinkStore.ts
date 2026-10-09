import { create } from 'zustand';

interface TakSinkState {
  /** The local TAK server is running or the remote relay is up or reconnecting. */
  active: boolean;
}

/** Whether main has a TAK sink; ingest checks it before any TAK-only parsing. Set from App. */
export const useTakSinkStore = create<TakSinkState>()(() => ({ active: false }));

export function setTakSinkActive(active: boolean): void {
  if (useTakSinkStore.getState().active !== active) useTakSinkStore.setState({ active });
}

export function isTakSinkActive(): boolean {
  return useTakSinkStore.getState().active;
}
