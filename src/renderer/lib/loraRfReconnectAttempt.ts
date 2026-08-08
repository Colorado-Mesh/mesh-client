/**
 * Shared LoRa RF reconnect attempt runner for Meshtastic and MeshCore.
 *
 * Owns the common backoff / single-flight / budget / finally-flush skeleton.
 * Protocol-specific open+attach/configure and exhaustion side effects stay in
 * runtime adapters (TCP burst, setup-abort, serial rediscovery UI, etc.).
 *
 * Pair with {@link createRfReconnectController} — the controller owns schedule /
 * link-lost / begin–end; this module owns one attempt body.
 */

import { raceWithDeadline } from './bleReconnectHelper';
import { createBleReconnectTransportCleanup } from './bleReconnectLateTransport';
import { errLikeToLogString } from './errLikeToLogString';
import type { RfReconnectController } from './rfReconnectController';
import { rfMaxReconnectAttemptsForTransport } from './rfReconnectShared';
import { delayUnlessSuspended } from './systemPowerState';
import { NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS } from './timeConstants';

export type LoraRfReconnectOverlapCheck = 'beforeOpening' | 'afterOpening';

export type LoraRfReconnectAttemptErrorAction = 'retry' | 'defer' | 'done';

export interface LoraRfReconnectBoolRef {
  get: () => boolean;
  set: (value: boolean) => void;
}

export interface LoraRfReconnectNumberRef {
  get: () => number;
  set: (value: number) => void;
}

export interface LoraRfReconnectOpenContext {
  generation: number;
  isBle: boolean;
  attemptActive: () => boolean;
  lateTransport: ReturnType<typeof createBleReconnectTransportCleanup>;
}

export interface LoraRfReconnectAttemptDeps<TParams> {
  logTag: string;
  controller: RfReconnectController;

  getParams: () => TParams | null;
  /** Transport key for attempt budget (`ble` / `serial` / `tcp` / …). */
  getTransportType: (params: TParams) => string;
  isBle: (params: TParams) => boolean;

  isExplicitDisconnect: () => boolean;
  isReconnecting: LoraRfReconnectBoolRef;
  generation: LoraRfReconnectNumberRef;
  attemptCounter: LoraRfReconnectNumberRef;
  deferredReconnect: LoraRfReconnectBoolRef;
  connectInFlight: LoraRfReconnectBoolRef;
  bleConnectInProgress?: LoraRfReconnectBoolRef;

  scheduleAttempt: () => void;
  setReconnectingUi: (attempt: number) => void;
  setDisconnectedUi: (opts?: { connectionLoss?: boolean }) => void;

  /** Default 32_000 (matches MeshCore / Meshtastic caps). */
  maxDelayMs?: number;
  /** Meshtastic checks overlapping open before beginOpening; MeshCore after. */
  overlapCheck: LoraRfReconnectOverlapCheck;

  disconnectIdentity: (identityId: string) => Promise<void>;

  /** Called when params are null at attempt start (Meshtastic clears richer UI state). */
  onMissingParams?: () => void;
  onExhausted: (params: TParams) => Promise<void>;
  runOpenAndAttach: (ctx: LoraRfReconnectOpenContext, params: TParams) => Promise<void>;
  /**
   * Protocol-specific failure handling after budget/open failure.
   * Return `retry` to schedule another attempt when generation is still current.
   */
  onAttemptError: (
    err: unknown,
    ctx: {
      params: TParams;
      generation: number;
      isBle: boolean;
      lateTransport: ReturnType<typeof createBleReconnectTransportCleanup>;
    },
  ) => Promise<LoraRfReconnectAttemptErrorAction>;
}

const DEFAULT_MAX_DELAY_MS = 32_000;

function shouldAbortDelay<TParams>(
  deps: LoraRfReconnectAttemptDeps<TParams>,
  generation: number,
): boolean {
  return !deps.isReconnecting.get() ? true : deps.generation.get() !== generation;
}

function flushDeferredOrEnd<TParams>(
  deps: LoraRfReconnectAttemptDeps<TParams>,
  opts: { keepReconnecting: boolean },
): 'flushed' | 'ended' {
  if (deps.deferredReconnect.get() && deps.isReconnecting.get() && !deps.isExplicitDisconnect()) {
    deps.deferredReconnect.set(false);
    deps.controller.endAttempt({ keepReconnecting: true });
    deps.scheduleAttempt();
    return 'flushed';
  }
  deps.controller.endAttempt({ keepReconnecting: opts.keepReconnecting });
  return 'ended';
}

/**
 * Run one LoRa RF reconnect attempt (backoff → open → settle).
 * Callers keep a thin `useCallback` that builds deps and awaits this.
 */
export async function runLoraRfReconnectAttempt<TParams>(
  deps: LoraRfReconnectAttemptDeps<TParams>,
): Promise<void> {
  const params = deps.getParams();
  if (!params) {
    deps.isReconnecting.set(false);
    deps.onMissingParams?.();
    return;
  }
  if (deps.isExplicitDisconnect()) {
    deps.isReconnecting.set(false);
    return;
  }

  const transportType = deps.getTransportType(params);
  const maxReconnectAttempts = rfMaxReconnectAttemptsForTransport(transportType);
  if (deps.attemptCounter.get() >= maxReconnectAttempts) {
    deps.isReconnecting.set(false);
    deps.attemptCounter.set(0);
    deps.controller.markExhausted();
    await deps.onExhausted(params);
    return;
  }

  const generation = deps.generation.get();
  deps.attemptCounter.set(deps.attemptCounter.get() + 1);
  const attemptNumber = deps.attemptCounter.get();
  deps.controller.beginAttempt(attemptNumber);
  deps.setReconnectingUi(attemptNumber);

  const maxDelayMs = deps.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const delay = Math.min(2000 * Math.pow(2, attemptNumber - 1), maxDelayMs);
  console.debug(
    `[${deps.logTag}] reconnect: waiting ${delay}ms before attempt ${attemptNumber}/${maxReconnectAttempts}`,
  );
  const delayResult = await delayUnlessSuspended(delay, () => shouldAbortDelay(deps, generation));

  if (delayResult === 'aborted') {
    // Generation bump during backoff (or cancel) aborted this delay. If a deferred restart was
    // requested, schedule the next attempt — do not leave isReconnecting true with no work
    // (MeshCore #795 / n7eal TCP parity).
    const flushed = flushDeferredOrEnd(deps, {
      keepReconnecting: deps.isReconnecting.get(),
    });
    if (flushed === 'flushed') return;
    if (!deps.isReconnecting.get()) {
      deps.setDisconnectedUi({ connectionLoss: true });
    }
    return;
  }
  if (delayResult === 'suspended') {
    deps.isReconnecting.set(false);
    deps.controller.cancel();
    deps.setDisconnectedUi({ connectionLoss: true });
    return;
  }

  if (!deps.isReconnecting.get() || deps.generation.get() !== generation) {
    const flushed = flushDeferredOrEnd(deps, {
      keepReconnecting: deps.isReconnecting.get(),
    });
    if (flushed === 'flushed') return;
    if (!deps.isReconnecting.get()) {
      deps.setDisconnectedUi({ connectionLoss: true });
    }
    return;
  }

  const skipOverlappingOpen = (): boolean => {
    if (!deps.connectInFlight.get()) return false;
    console.debug(`[${deps.logTag}] reconnect: skip overlapping open (connect already in flight)`);
    deps.deferredReconnect.set(true);
    deps.controller.markDirty();
    return true;
  };

  if (deps.overlapCheck === 'beforeOpening' && skipOverlappingOpen()) {
    return;
  }

  deps.controller.beginOpening();

  if (deps.overlapCheck === 'afterOpening' && skipOverlappingOpen()) {
    return;
  }

  const isBle = deps.isBle(params);
  deps.connectInFlight.set(true);
  if (isBle) deps.bleConnectInProgress?.set(true);

  let attemptActive = true;
  const lateTransport = createBleReconnectTransportCleanup(deps.disconnectIdentity, deps.logTag);

  const runOpen = async () => {
    await deps.runOpenAndAttach(
      {
        generation,
        isBle,
        attemptActive: () => attemptActive,
        lateTransport,
      },
      params,
    );
  };
  const reconnectWork = runOpen();
  // Late loser after budget timeout — avoid unhandledRejection; cleanup is in catch / late path.
  void reconnectWork.catch((e: unknown) => {
    console.debug(`[${deps.logTag}] reconnectWork late reject ` + errLikeToLogString(e));
  });

  try {
    // Applied to every transport, not just BLE (constant name is historical): TCP/HTTP/serial
    // reconnects used to await open+attach/configure with no ceiling. A disconnect mid-open
    // defers to that attempt settling; without a deadline, a hang wedges the reconnect machine.
    await raceWithDeadline(
      reconnectWork,
      NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS,
      `Reconnect attempt timed out after ${NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS}ms`,
    );
  } catch (err) {
    // catch-no-log-ok protocol onAttemptError logs the failure (warn/debug)
    attemptActive = false;
    const action = await deps.onAttemptError(err, {
      params,
      generation,
      isBle,
      lateTransport,
    });
    if (
      action === 'retry' &&
      !deps.deferredReconnect.get() &&
      deps.isReconnecting.get() &&
      deps.generation.get() === generation
    ) {
      deps.scheduleAttempt();
    }
  } finally {
    attemptActive = false;
    deps.connectInFlight.set(false);
    if (isBle) deps.bleConnectInProgress?.set(false);
    if (deps.deferredReconnect.get()) {
      deps.controller.markDirty();
    }
    const settled = deps.controller.endAttempt({
      keepReconnecting: deps.isReconnecting.get(),
    });
    if (deps.deferredReconnect.get() || settled.shouldSchedule) {
      deps.deferredReconnect.set(false);
      if (deps.isReconnecting.get()) {
        console.debug(
          `[${deps.logTag}] reconnect settled — running deferred reconnect after transport drop`,
        );
        // Call attempt via schedule (coalesced) — nested connection-lost re-bumped generation
        // and raced a second backoff loop with this flush (MeshCore #792 / n7eal TCP parity).
        deps.scheduleAttempt();
      }
    }
  }
}
