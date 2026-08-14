import type { Dispatch, SetStateAction } from 'react';

import { MESHCORE_WAITING_MESSAGES_SILENT_FOLLOW_UP_CHAIN_MAX } from '../../lib/timeConstants';

let processWaitingMessagesInFlight: Promise<void> | null = null;
let processWaitingMessagesFollowUpRequested = false;
let processWaitingMessagesManualFollowUpRequested = false;
/** CLI force-kick coalesced onto an in-flight drain — must bypass reply-hold deferral. */
let processWaitingMessagesForceFollowUpRequested = false;
let processWaitingMessagesForceFollowUpIncremental = false;
/** Silent follow-ups taken in the current 131 drain chain (reset when chain settles). */
let silentFollowUpChainCount = 0;

export function getMeshcoreProcessWaitingMessagesInFlight(): Promise<void> | null {
  return processWaitingMessagesInFlight;
}

export function setMeshcoreProcessWaitingMessagesInFlight(inFlight: Promise<void> | null): void {
  processWaitingMessagesInFlight = inFlight;
}

/** Request one follow-up silent drain after the current in-flight drain settles. */
export function requestMeshcoreWaitingMessagesFollowUp(): void {
  if (!processWaitingMessagesInFlight) return;
  if (silentFollowUpChainCount >= MESHCORE_WAITING_MESSAGES_SILENT_FOLLOW_UP_CHAIN_MAX) {
    console.warn(
      `[meshcoreWaitingMessagesSyncState] silent follow-up chain capped at ${MESHCORE_WAITING_MESSAGES_SILENT_FOLLOW_UP_CHAIN_MAX}`,
    );
    return;
  }
  processWaitingMessagesFollowUpRequested = true;
}

export function takeMeshcoreWaitingMessagesFollowUp(): boolean {
  const requested = processWaitingMessagesFollowUpRequested;
  processWaitingMessagesFollowUpRequested = false;
  if (requested) {
    silentFollowUpChainCount += 1;
  }
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

/**
 * CLI reply path: when a force drain coalesces onto an in-flight drain, schedule another
 * force+optional-incremental drain that runs immediately when the current one settles —
 * without going through scheduleMeshcoreWaitingMessagesDrain (which defers while CLI hold).
 */
export function requestMeshcoreWaitingMessagesForceFollowUp(incrementalOnly = false): void {
  if (!processWaitingMessagesInFlight) return;
  processWaitingMessagesForceFollowUpRequested = true;
  if (incrementalOnly) {
    processWaitingMessagesForceFollowUpIncremental = true;
  }
}

export function takeMeshcoreWaitingMessagesForceFollowUp(): {
  incrementalOnly: boolean;
} | null {
  if (!processWaitingMessagesForceFollowUpRequested) return null;
  processWaitingMessagesForceFollowUpRequested = false;
  const incrementalOnly = processWaitingMessagesForceFollowUpIncremental;
  processWaitingMessagesForceFollowUpIncremental = false;
  return { incrementalOnly };
}

export function clearMeshcoreWaitingMessagesFollowUp(): void {
  processWaitingMessagesFollowUpRequested = false;
  processWaitingMessagesManualFollowUpRequested = false;
  processWaitingMessagesForceFollowUpRequested = false;
  processWaitingMessagesForceFollowUpIncremental = false;
}

/** Reset the silent follow-up chain counter when a drain settles with no further work. */
export function resetMeshcoreWaitingMessagesSilentFollowUpChain(): void {
  silentFollowUpChainCount = 0;
}

/** Test hook — current silent follow-up chain depth. */
export function getMeshcoreWaitingMessagesSilentFollowUpChainCount(): number {
  return silentFollowUpChainCount;
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
  processWaitingMessagesForceFollowUpRequested = false;
  processWaitingMessagesForceFollowUpIncremental = false;
  silentFollowUpChainCount = 0;
  setWaitingMessagesCount(0);
  setWaitingMessagesSyncActive(false);
  setWaitingMessagesSyncProgress(null);
  setWaitingMessagesSilentDrainActive?.(false);
  setWaitingMessagesDrainDeferred?.(false);
}
