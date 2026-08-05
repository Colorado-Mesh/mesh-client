/**
 * Single-owner LoRa RF reconnect scheduler for MeshCore and Meshtastic.
 *
 * Invariant: while a reconnect cycle is active (`isReconnecting`), `onLinkLost` never
 * starts a parallel attempt — it only bumps generation and sets `dirty`. The attempt
 * owner (backoff delay abort / attempt finally) is the sole caller of the next schedule.
 *
 * This closes the n7eal TCP race where connection-lost awaited disconnect, the in-flight
 * attempt's finally cleared "in flight" and scheduled attempt N, then lost resumed and
 * scheduled attempt N+1 (~30ms later).
 */

export type RfReconnectPhase = 'idle' | 'backoff' | 'opening';

export type RfReconnectDelayResult = 'done' | 'aborted' | 'suspended';

export interface RfReconnectControllerOptions {
  /** Prefix for console.debug lines (e.g. useMeshcoreRuntime). */
  logTag: string;
  /** Optional inject for tests (default queueMicrotask). */
  scheduleMicrotask?: (fn: () => void) => void;
}

export interface RfReconnectLinkLostResult {
  /** True only when this call transitions idle → reconnecting and the caller should kick the owner. */
  shouldStartOwner: boolean;
  /** Generation after the bump (in-flight open/backoff should abort when mismatched). */
  generation: number;
}

export interface RfReconnectController {
  readonly phase: RfReconnectPhase;
  readonly generation: number;
  readonly attempt: number;
  readonly isReconnecting: boolean;
  readonly dirty: boolean;
  /** True from attempt start through backoff+open until settle (not only during open). */
  readonly attemptActive: boolean;

  /**
   * Link drop. When already reconnecting: bump generation + dirty, never ask caller to start
   * another owner. When idle: mark reconnecting and ask caller to start the owner once.
   */
  onLinkLost(): RfReconnectLinkLostResult;

  /** User disconnect / power suspend cancel — idle, clear dirty, bump generation. */
  cancel(): void;

  /** Reset attempt counter after a successful reconnect (cycle ends). */
  markSuccess(): void;

  /** Exhausted max attempts — back to idle. */
  markExhausted(): void;

  /**
   * Begin an owner attempt (caller increments UI attempt / starts delay).
   * Sets phase=backoff and attemptActive until {@link endAttempt}.
   */
  beginAttempt(attemptNumber: number): { generation: number };

  /** Transition backoff → opening after delay completes. */
  beginOpening(): void;

  /**
   * End the current owner attempt. If dirty and still reconnecting, returns shouldSchedule
   * so the caller runs exactly one follow-up (Neal flush path).
   */
  endAttempt(opts?: { keepReconnecting?: boolean }): {
    shouldSchedule: boolean;
    generation: number;
  };

  /**
   * Coalesced schedule of the owner runner. If an attempt is already active, sets dirty
   * instead of invoking run (single-flight during backoff+open).
   */
  scheduleOwner(run: () => void): void;

  /** Test/helper: set dirty without a link-lost (e.g. delay-abort deferred restart). */
  markDirty(): void;
}

export function createRfReconnectController(
  options: RfReconnectControllerOptions,
): RfReconnectController {
  const logTag = options.logTag;
  const scheduleMicrotask = options.scheduleMicrotask ?? queueMicrotask;

  let phase: RfReconnectPhase = 'idle';
  let generation = 0;
  let attempt = 0;
  let isReconnecting = false;
  let dirty = false;
  let attemptActive = false;
  let schedulePending = false;

  const self: RfReconnectController = {
    get phase() {
      return phase;
    },
    get generation() {
      return generation;
    },
    get attempt() {
      return attempt;
    },
    get isReconnecting() {
      return isReconnecting;
    },
    get dirty() {
      return dirty;
    },
    get attemptActive() {
      return attemptActive;
    },

    onLinkLost(): RfReconnectLinkLostResult {
      generation += 1;
      if (isReconnecting) {
        dirty = true;
        console.debug(
          `[${logTag}] rfReconnect: link lost during ${phase} — dirty gen=${generation} (owner schedules)`,
        );
        return { shouldStartOwner: false, generation };
      }
      isReconnecting = true;
      dirty = false;
      console.debug(`[${logTag}] rfReconnect: link lost — start owner gen=${generation}`);
      return { shouldStartOwner: true, generation };
    },

    cancel(): void {
      generation += 1;
      isReconnecting = false;
      dirty = false;
      attemptActive = false;
      attempt = 0;
      phase = 'idle';
      schedulePending = false;
    },

    markSuccess(): void {
      isReconnecting = false;
      dirty = false;
      attemptActive = false;
      attempt = 0;
      phase = 'idle';
    },

    markExhausted(): void {
      isReconnecting = false;
      dirty = false;
      attemptActive = false;
      phase = 'idle';
    },

    beginAttempt(attemptNumber: number): { generation: number } {
      attempt = attemptNumber;
      attemptActive = true;
      phase = 'backoff';
      return { generation };
    },

    beginOpening(): void {
      phase = 'opening';
    },

    endAttempt(opts?: { keepReconnecting?: boolean }): {
      shouldSchedule: boolean;
      generation: number;
    } {
      attemptActive = false;
      phase = isReconnecting || opts?.keepReconnecting ? 'idle' : 'idle';
      const keep = opts?.keepReconnecting ?? isReconnecting;
      if (!keep) {
        dirty = false;
        isReconnecting = false;
        return { shouldSchedule: false, generation };
      }
      if (dirty) {
        dirty = false;
        console.debug(
          `[${logTag}] rfReconnect: attempt settled — scheduling deferred owner gen=${generation}`,
        );
        return { shouldSchedule: true, generation };
      }
      return { shouldSchedule: false, generation };
    },

    scheduleOwner(run: () => void): void {
      if (schedulePending) return;
      schedulePending = true;
      scheduleMicrotask(() => {
        schedulePending = false;
        if (!isReconnecting) return;
        if (attemptActive) {
          dirty = true;
          console.debug(
            `[${logTag}] rfReconnect: schedule coalesced into dirty (attempt already active)`,
          );
          return;
        }
        run();
      });
    },

    markDirty(): void {
      dirty = true;
    },
  };

  return self;
}
