import type { Dispatch, SetStateAction } from 'react';

let processWaitingMessagesInFlight: Promise<void> | null = null;
let processWaitingMessagesFollowUpRequested = false;
let processWaitingMessagesManualFollowUpRequested = false;

export function getMeshcoreProcessWaitingMessagesInFlight(): Promise<void> | null {
  return processWaitingMessagesInFlight;
}

export function setMeshcoreProcessWaitingMessagesInFlight(inFlight: Promise<void> | null): void {
  processWaitingMessagesInFlight = inFlight;
}

/** Request one follow-up silent drain after the current in-flight drain settles. */
export function requestMeshcoreWaitingMessagesFollowUp(): void {
  if (processWaitingMessagesInFlight) {
    processWaitingMessagesFollowUpRequested = true;
  }
}

export function takeMeshcoreWaitingMessagesFollowUp(): boolean {
  const requested = processWaitingMessagesFollowUpRequested;
  processWaitingMessagesFollowUpRequested = false;
  return requested;
}

/** Request one follow-up manual sync (Sync now) after the current in-flight drain settles. */
export function requestMeshcoreWaitingMessagesManualFollowUp(): void {
  if (processWaitingMessagesInFlight) {
    processWaitingMessagesManualFollowUpRequested = true;
  }
}

export function takeMeshcoreWaitingMessagesManualFollowUp(): boolean {
  const requested = processWaitingMessagesManualFollowUpRequested;
  processWaitingMessagesManualFollowUpRequested = false;
  return requested;
}

export function clearMeshcoreWaitingMessagesFollowUp(): void {
  processWaitingMessagesFollowUpRequested = false;
  processWaitingMessagesManualFollowUpRequested = false;
}

/** Clear module in-flight guard and Chat waiting-message UI (disconnect / listener teardown). */
export function resetMeshcoreProcessWaitingMessagesSync(
  setWaitingMessagesCount: Dispatch<SetStateAction<number>>,
  setWaitingMessagesSyncActive: Dispatch<SetStateAction<boolean>>,
  setWaitingMessagesSyncProgress: Dispatch<
    SetStateAction<{ processed: number; total: number } | null>
  >,
  setWaitingMessagesSilentDrainActive?: Dispatch<SetStateAction<boolean>>,
  setWaitingMessagesDrainDeferred?: Dispatch<SetStateAction<boolean>>,
): void {
  processWaitingMessagesInFlight = null;
  processWaitingMessagesFollowUpRequested = false;
  processWaitingMessagesManualFollowUpRequested = false;
  setWaitingMessagesCount(0);
  setWaitingMessagesSyncActive(false);
  setWaitingMessagesSyncProgress(null);
  setWaitingMessagesSilentDrainActive?.(false);
  setWaitingMessagesDrainDeferred?.(false);
}
