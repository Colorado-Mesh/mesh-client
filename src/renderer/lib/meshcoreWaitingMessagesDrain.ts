import { isMeshcoreTcpTransportDeadError } from '@/renderer/lib/bleConnectErrors';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { isMeshcoreFloodScopeOverrideActive } from './meshcoreFloodScopeSend';
import { meshcoreCompanionRepeaterRfBusy } from './meshcoreRepeaterRpcInFlight';
import { meshcoreTraceResponsesInFlightCount } from './meshcoreTracePathMultiplex';
import {
  MESHCORE_WAITING_MESSAGES_AFTER_TX_DEFER_MS,
  MESHCORE_WAITING_MESSAGES_CONGESTED_RETRY_MS,
  MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS,
  MESHCORE_WAITING_MESSAGES_POLL_MS,
  MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP,
  MESHCORE_WAITING_MESSAGES_SILENT_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_SYNC_TIMEOUT_MS,
} from './timeConstants';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastCompanionTxAt = 0;
let lastMsgWaitingEventAt = 0;
/** Bumped when silent bulk is abandoned so a late getWaitingMessages resolve is ignored. */
let silentBulkAttemptId = 0;
/** Consecutive silent-bulk getWaitingMessages timeouts on this connection. */
let silentBulkTimeoutStreak = 0;
/** Once tripped, skip bulk and go straight to syncNextMessage until reconnect/success. */
let silentBulkSkipped = false;

/** Record outbound companion RF TX so auto-drains can defer until the radio settles. */
export function markMeshcoreCompanionTx(): void {
  lastCompanionTxAt = Date.now();
}

/**
 * Test hook — reset debounce/TX stamps between unit tests.
 * Invalidates in-flight silent bulk attempts by bumping the monotonic counter (never
 * recycles a prior id back to 0, so late pre-reset results stay stale).
 */
export function resetMeshcoreWaitingMessagesDrainState(now = 0): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  lastCompanionTxAt = now;
  lastMsgWaitingEventAt = now;
  silentBulkAttemptId += 1;
  resetMeshcoreSilentBulkBreaker();
}

/** Start a silent bulk getWaitingMessages attempt; return id used by {@link isMeshcoreSilentBulkAttemptCurrent}. */
export function beginMeshcoreSilentBulkAttempt(): number {
  silentBulkAttemptId += 1;
  return silentBulkAttemptId;
}

/** Abandon the current silent bulk attempt (timeout/fallback) so late results are ignored. */
export function abandonMeshcoreSilentBulkAttempt(attemptId: number): void {
  if (attemptId === silentBulkAttemptId) {
    silentBulkAttemptId += 1;
  }
}

/** True when `attemptId` is still the active silent bulk attempt. */
export function isMeshcoreSilentBulkAttemptCurrent(attemptId: number): boolean {
  return attemptId === silentBulkAttemptId;
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

/**
 * True when the companion link is already dead — silent drain must not start syncNextMessage
 * fallback (reconnect / OpenHop dead-bridge paths own recovery). Never disconnects from here.
 */
export function isMeshcoreWaitingMessagesTransportDeadError(error: unknown): boolean {
  if (isMeshcoreTcpTransportDeadError(error)) return true;
  const msg = errLikeToLogString(error).toLowerCase();
  return (
    msg.includes('no active socket') ||
    msg.includes('gatt server is disconnected') ||
    msg.includes('device disconnected') ||
    msg.includes('not connected')
  );
}

/**
 * True when silent bulk getWaitingMessages failed in a way that is safe to fall back to
 * syncNextMessage (timeout / transient). Transport-dead is never a fallback candidate.
 */
export function isMeshcoreWaitingMessagesBulkFallbackError(error: unknown): boolean {
  if (isMeshcoreWaitingMessagesTransportDeadError(error)) return false;
  const msg = errLikeToLogString(error).toLowerCase();
  return msg.includes('timed out') || msg.includes('timeout') || msg.includes('busy');
}

/** getWaitingMessages timeout label used by silent bulk withTimeout. */
export function isMeshcoreGetWaitingMessagesTimeoutError(error: unknown): boolean {
  const errMsg = errLikeToLogString(error).toLowerCase();
  return errMsg.includes('getwaitingmessages') && errMsg.includes('timed out');
}

export function resetMeshcoreWaitingMessagesDrainSchedule(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  silentBulkAttemptId += 1;
  resetMeshcoreSilentBulkBreaker();
}

/** Skip silent bulk getWaitingMessages after consecutive timeouts on this connection. */
export function shouldSkipMeshcoreSilentBulkGetWaitingMessages(): boolean {
  return silentBulkSkipped;
}

/** Record a successful silent bulk drain (including empty queue). */
export function noteMeshcoreSilentBulkSuccess(): void {
  silentBulkTimeoutStreak = 0;
  silentBulkSkipped = false;
}

/**
 * Record a silent-bulk getWaitingMessages timeout.
 * @returns true when this call opens the circuit (log once).
 */
export function noteMeshcoreSilentBulkTimeout(): boolean {
  silentBulkTimeoutStreak += 1;
  if (silentBulkTimeoutStreak < MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP) {
    return false;
  }
  if (silentBulkSkipped) return false;
  silentBulkSkipped = true;
  return true;
}

/** Clear the silent-bulk timeout circuit (reconnect / tests). */
export function resetMeshcoreSilentBulkBreaker(): void {
  silentBulkTimeoutStreak = 0;
  silentBulkSkipped = false;
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
  return (
    meshcoreTraceResponsesInFlightCount() > 0 ||
    meshcoreCompanionRepeaterRfBusy() ||
    isMeshcoreFloodScopeOverrideActive()
  );
}

const DRAIN_IDLE_POLL_MS = 250;

/** Wait until silent/manual waiting-message drain is idle, or until timeout. */
export async function awaitMeshcoreWaitingMessagesDrainIdle(
  isBusy: () => boolean,
  timeoutMs: number = MESHCORE_WAITING_MESSAGES_SILENT_TIMEOUT_MS,
): Promise<boolean> {
  if (!isBusy()) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, DRAIN_IDLE_POLL_MS);
    });
    if (!isBusy()) return true;
  }
  return !isBusy();
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
        options.onDeferredChange?.(false);
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
