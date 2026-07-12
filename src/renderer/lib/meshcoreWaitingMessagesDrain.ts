import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { meshcoreCompanionRepeaterRfBusy } from './meshcoreRepeaterRpcInFlight';
import { meshcoreTraceResponsesInFlightCount } from './meshcoreTracePathMultiplex';
import {
  MESHCORE_WAITING_MESSAGES_AFTER_TX_DEFER_MS,
  MESHCORE_WAITING_MESSAGES_CONGESTED_RETRY_MS,
  MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS,
  MESHCORE_WAITING_MESSAGES_POLL_MS,
  MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_SILENT_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_SYNC_TIMEOUT_MS,
} from './timeConstants';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastCompanionTxAt = 0;
let lastMsgWaitingEventAt = 0;

/** Record outbound companion RF TX so auto-drains can defer until the radio settles. */
export function markMeshcoreCompanionTx(): void {
  lastCompanionTxAt = Date.now();
}

/** Test hook — reset module state between unit tests. */
export function resetMeshcoreWaitingMessagesDrainState(now = 0): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  lastCompanionTxAt = now;
  lastMsgWaitingEventAt = now;
}

/** Record MsgWaiting (event 131) so periodic safety-net polls can skip idle queues. */
export function markMeshcoreMsgWaitingEvent(now = Date.now()): void {
  lastMsgWaitingEventAt = now;
}

/** True when the 5-minute safety-net poll should run (queued count or recent event 131). */
export function shouldRunMeshcoreWaitingMessagesPeriodicPoll(
  waitingMessagesCount: number,
  now = Date.now(),
): boolean {
  if (waitingMessagesCount > 0) return true;
  return now - lastMsgWaitingEventAt < MESHCORE_WAITING_MESSAGES_POLL_MS;
}

/** True when silent incremental syncNextMessage hit the fail-fast timeout (empty queue). */
export function isMeshcoreSyncNextMessageTimeoutError(error: unknown): boolean {
  const errMsg = errLikeToLogString(error).toLowerCase();
  return errMsg.includes('syncnextmessage') && errMsg.includes('timed out');
}

export function resetMeshcoreWaitingMessagesDrainSchedule(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export type MeshcoreCompanionTransport = 'ble' | 'serial' | 'tcp' | null | undefined;

export function waitingMessagesDrainTimeoutMs(
  showSyncBanner: boolean,
  connectionType?: MeshcoreCompanionTransport,
): number {
  if (showSyncBanner) {
    return MESHCORE_WAITING_MESSAGES_SYNC_TIMEOUT_MS;
  }
  if (connectionType === 'serial') {
    return MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS;
  }
  return MESHCORE_WAITING_MESSAGES_SILENT_TIMEOUT_MS;
}

export function shouldActivateWaitingMessagesBanner(
  showSyncBanner: boolean,
  total: number,
): boolean {
  return showSyncBanner && total > 0;
}

/** True when companion admin/trace work will likely stall getWaitingMessages / syncNextMessage. */
export function isMeshcoreCompanionDrainDeferred(): boolean {
  return meshcoreTraceResponsesInFlightCount() > 0 || meshcoreCompanionRepeaterRfBusy();
}

/** Silent auto-drain timeouts during BLE congestion are expected — log at debug, not warn. */
export function logMeshcoreWaitingMessagesDrainError(
  context: string,
  error: unknown,
  showSyncBanner: boolean,
): void {
  const errMsg = errLikeToLogString(error);
  const isSilentTimeout =
    !showSyncBanner &&
    (errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('timed out'));
  if (isSilentTimeout) {
    console.debug(`[useMeshcoreRuntime] ${context} ${errMsg}`);
    return;
  }
  console.warn(`[useMeshcoreRuntime] ${context} ${errMsg}`);
}

export interface ScheduleMeshcoreWaitingMessagesDrainOptions {
  isMounted?: () => boolean;
  onDeferredChange?: (deferred: boolean) => void;
}

/**
 * Debounce MsgWaiting (131) auto-drains and defer briefly after recent companion TX.
 * Failure point: drain throws — caller should log; no UI for silent paths.
 */
export function scheduleMeshcoreWaitingMessagesDrain(
  drain: () => Promise<void>,
  options?: ScheduleMeshcoreWaitingMessagesDrainOptions,
): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void (async () => {
      const elapsedSinceTx = Date.now() - lastCompanionTxAt;
      const deferRemaining = MESHCORE_WAITING_MESSAGES_AFTER_TX_DEFER_MS - elapsedSinceTx;
      if (deferRemaining > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, deferRemaining);
        });
      }
      if (options?.isMounted && !options.isMounted()) {
        options?.onDeferredChange?.(false);
        return;
      }
      if (isMeshcoreCompanionDrainDeferred()) {
        options?.onDeferredChange?.(true);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          scheduleMeshcoreWaitingMessagesDrain(drain, options);
        }, MESHCORE_WAITING_MESSAGES_CONGESTED_RETRY_MS);
        return;
      }
      options?.onDeferredChange?.(false);
      await drain();
    })();
  }, MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS);
}
