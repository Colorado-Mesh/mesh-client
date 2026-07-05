import type { Dispatch, SetStateAction } from 'react';

let processWaitingMessagesInFlight: Promise<void> | null = null;

export function getMeshcoreProcessWaitingMessagesInFlight(): Promise<void> | null {
  return processWaitingMessagesInFlight;
}

export function setMeshcoreProcessWaitingMessagesInFlight(inFlight: Promise<void> | null): void {
  processWaitingMessagesInFlight = inFlight;
}

/** Clear module in-flight guard and Chat waiting-message UI (disconnect / listener teardown). */
export function resetMeshcoreProcessWaitingMessagesSync(
  setWaitingMessagesCount: Dispatch<SetStateAction<number>>,
  setWaitingMessagesSyncActive: Dispatch<SetStateAction<boolean>>,
  setWaitingMessagesSyncProgress: Dispatch<
    SetStateAction<{ processed: number; total: number } | null>
  >,
): void {
  processWaitingMessagesInFlight = null;
  setWaitingMessagesCount(0);
  setWaitingMessagesSyncActive(false);
  setWaitingMessagesSyncProgress(null);
}
