import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as meshcoreRepeaterRpcInFlight from './meshcoreRepeaterRpcInFlight';
import * as meshcoreTracePathMultiplex from './meshcoreTracePathMultiplex';
import {
  abandonMeshcoreSilentBulkAttempt,
  awaitMeshcoreWaitingMessagesDrainIdle,
  beginMeshcoreSilentBulkAttempt,
  endMeshcoreSilentBulkCliPreempt,
  isMeshcoreCompanionDrainDeferred,
  isMeshcoreSilentBulkAttemptCurrent,
  isMeshcoreSyncNextMessageTimeoutError,
  isMeshcoreWaitingMessagesBulkFallbackError,
  isMeshcoreWaitingMessagesTransportDeadError,
  logMeshcoreWaitingMessagesDrainError,
  markMeshcoreCompanionTx,
  markMeshcoreMsgWaitingEvent,
  meshcoreWaitingMessagesCongestedRetryMs,
  meshcoreWaitingMessagesPeriodicPollDue,
  meshcoreWaitingMessagesPeriodicPollIntervalMs,
  noteMeshcoreSilentBulkSuccess,
  noteMeshcoreSilentBulkTimeout,
  preemptMeshcoreSilentBulkForCli,
  resetMeshcoreSilentBulkBreaker,
  resetMeshcoreWaitingMessagesDrainSchedule,
  resetMeshcoreWaitingMessagesDrainState,
  scheduleMeshcoreWaitingMessagesDrain,
  shouldActivateWaitingMessagesBanner,
  shouldPreferMeshcoreSilentIncrementalDrain,
  shouldRunMeshcoreWaitingMessagesPeriodicPoll,
  shouldSkipMeshcoreSilentBulkGetWaitingMessages,
  waitingMessagesDrainTimeoutMs,
} from './meshcoreWaitingMessagesDrain';
import {
  MESHCORE_WAITING_MESSAGES_AFTER_TX_DEFER_MS,
  MESHCORE_WAITING_MESSAGES_CIRCUIT_OPEN_BACKOFF_FACTOR,
  MESHCORE_WAITING_MESSAGES_CONGESTED_RETRY_MS,
  MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS,
  MESHCORE_WAITING_MESSAGES_POLL_MS,
  MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP,
  MESHCORE_WAITING_MESSAGES_SILENT_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_SYNC_TIMEOUT_MS,
} from './timeConstants';

describe('waitingMessagesDrainTimeoutMs', () => {
  it('uses the silent timeout for auto-drains', () => {
    expect(waitingMessagesDrainTimeoutMs(false)).toBe(MESHCORE_WAITING_MESSAGES_SILENT_TIMEOUT_MS);
  });

  it('uses a shorter silent timeout for USB serial auto-drains', () => {
    expect(waitingMessagesDrainTimeoutMs(false, 'serial')).toBe(
      MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS,
    );
  });

  it('uses the shorter silent timeout for BLE auto-drains', () => {
    expect(waitingMessagesDrainTimeoutMs(false, 'ble')).toBe(
      MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS,
    );
  });

  it('uses the shorter silent timeout for TCP auto-drains', () => {
    expect(waitingMessagesDrainTimeoutMs(false, 'tcp')).toBe(
      MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS,
    );
  });

  it('uses the manual sync timeout for Chat Sync now', () => {
    expect(waitingMessagesDrainTimeoutMs(true)).toBe(MESHCORE_WAITING_MESSAGES_SYNC_TIMEOUT_MS);
  });
});

describe('shouldActivateWaitingMessagesBanner', () => {
  it('does not activate the banner for silent drains', () => {
    expect(shouldActivateWaitingMessagesBanner(false, 5)).toBe(false);
  });

  it('does not activate the banner for manual sync with an empty queue', () => {
    expect(shouldActivateWaitingMessagesBanner(true, 0)).toBe(false);
  });

  it('activates the banner only for manual sync with a backlog', () => {
    expect(shouldActivateWaitingMessagesBanner(true, 3)).toBe(true);
  });
});

describe('scheduleMeshcoreWaitingMessagesDrain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMeshcoreWaitingMessagesDrainState(0);
  });

  afterEach(() => {
    resetMeshcoreWaitingMessagesDrainSchedule();
    vi.useRealTimers();
  });

  it('debounces multiple MsgWaiting events into one drain', async () => {
    const drain = vi.fn().mockResolvedValue(undefined);

    scheduleMeshcoreWaitingMessagesDrain(drain);
    scheduleMeshcoreWaitingMessagesDrain(drain);

    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS - 1);
    expect(drain).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('defers auto-drain until recent companion TX settles', async () => {
    const drain = vi.fn().mockResolvedValue(undefined);
    markMeshcoreCompanionTx();

    scheduleMeshcoreWaitingMessagesDrain(drain);
    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS);
    await Promise.resolve();
    expect(drain).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_AFTER_TX_DEFER_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('skips drain when isMounted returns false after defer', async () => {
    const drain = vi.fn().mockResolvedValue(undefined);

    scheduleMeshcoreWaitingMessagesDrain(drain, { isMounted: () => false });
    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(drain).not.toHaveBeenCalled();
  });

  it('defers drain while a trace awaits TraceData, then retries', async () => {
    let traceInFlight = true;
    const inFlightSpy = vi
      .spyOn(meshcoreTracePathMultiplex, 'meshcoreTraceResponsesInFlightCount')
      .mockImplementation(() => (traceInFlight ? 1 : 0));

    const drain = vi.fn().mockResolvedValue(undefined);
    scheduleMeshcoreWaitingMessagesDrain(drain);
    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(drain).not.toHaveBeenCalled();

    traceInFlight = false;
    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_CONGESTED_RETRY_MS);
    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(drain).toHaveBeenCalledTimes(1);
    inFlightSpy.mockRestore();
  });

  it('defers drain while repeater admin RPC is busy, then retries', async () => {
    let repeaterBusy = true;
    const busySpy = vi
      .spyOn(meshcoreRepeaterRpcInFlight, 'meshcoreCompanionRepeaterRfBusy')
      .mockImplementation(() => repeaterBusy);

    const drain = vi.fn().mockResolvedValue(undefined);
    scheduleMeshcoreWaitingMessagesDrain(drain);
    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(drain).not.toHaveBeenCalled();

    repeaterBusy = false;
    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_CONGESTED_RETRY_MS);
    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(drain).toHaveBeenCalledTimes(1);
    busySpy.mockRestore();
  });

  it('notifies onDeferredChange while waiting on congested companion work', async () => {
    const onDeferredChange = vi.fn();
    const inFlightSpy = vi
      .spyOn(meshcoreTracePathMultiplex, 'meshcoreTraceResponsesInFlightCount')
      .mockReturnValue(1);

    const drain = vi.fn().mockResolvedValue(undefined);
    scheduleMeshcoreWaitingMessagesDrain(drain, { onDeferredChange });
    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(onDeferredChange).toHaveBeenCalledWith(true);
    expect(drain).not.toHaveBeenCalled();
    inFlightSpy.mockRestore();
  });
});

describe('isMeshcoreCompanionDrainDeferred', () => {
  it('returns true when repeater admin RPC is in flight', () => {
    const busySpy = vi
      .spyOn(meshcoreRepeaterRpcInFlight, 'meshcoreCompanionRepeaterRfBusy')
      .mockReturnValue(true);
    expect(isMeshcoreCompanionDrainDeferred()).toBe(true);
    busySpy.mockRestore();
  });

  it('ignores in-flight TraceData while a CLI reply hold is active', () => {
    const holdSpy = vi
      .spyOn(meshcoreRepeaterRpcInFlight, 'meshcoreCliReplyHoldActive')
      .mockReturnValue(true);
    const inFlightSpy = vi
      .spyOn(meshcoreTracePathMultiplex, 'meshcoreTraceResponsesInFlightCount')
      .mockReturnValue(1);
    // Automatic drains defer during CLI hold; force kicks bypass via options.force.
    expect(isMeshcoreCompanionDrainDeferred()).toBe(true);
    holdSpy.mockRestore();
    inFlightSpy.mockRestore();
  });
});

describe('logMeshcoreWaitingMessagesDrainError', () => {
  it('logs silent timeouts at debug', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logMeshcoreWaitingMessagesDrainError(
      'initConn drain',
      new Error('timed out after 15000ms'),
      false,
    );
    expect(debugSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    debugSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('logs manual sync failures at warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logMeshcoreWaitingMessagesDrainError('manual sync', new Error('timed out after 60000ms'), true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('isMeshcoreSyncNextMessageTimeoutError', () => {
  it('matches silent syncNextMessage timeout messages', () => {
    expect(
      isMeshcoreSyncNextMessageTimeoutError(
        new Error('MeshCore syncNextMessage timed out after 12000ms'),
      ),
    ).toBe(true);
    expect(isMeshcoreSyncNextMessageTimeoutError(new Error('getWaitingMessages timed out'))).toBe(
      false,
    );
  });
});

describe('silent bulk error classifiers', () => {
  it('treats tcp-write dead as transport-dead (no fallback)', () => {
    expect(
      isMeshcoreWaitingMessagesTransportDeadError(
        new Error('meshcore:tcp-write: no active socket'),
      ),
    ).toBe(true);
    expect(
      isMeshcoreWaitingMessagesBulkFallbackError(new Error('meshcore:tcp-write: no active socket')),
    ).toBe(false);
  });

  it('treats getWaitingMessages timeout as fallback-safe', () => {
    expect(
      isMeshcoreWaitingMessagesBulkFallbackError(
        new Error('MeshCore getWaitingMessages timed out after 45000ms'),
      ),
    ).toBe(true);
    expect(
      isMeshcoreWaitingMessagesTransportDeadError(
        new Error('MeshCore getWaitingMessages timed out after 45000ms'),
      ),
    ).toBe(false);
  });

  it('bumps silent bulk attempt id on abandon so late results are stale', () => {
    resetMeshcoreWaitingMessagesDrainState(0);
    const id = beginMeshcoreSilentBulkAttempt();
    expect(isMeshcoreSilentBulkAttemptCurrent(id)).toBe(true);
    abandonMeshcoreSilentBulkAttempt(id);
    expect(isMeshcoreSilentBulkAttemptCurrent(id)).toBe(false);
  });

  it('ignores abandon of a stale attempt id so the newer attempt stays current', () => {
    resetMeshcoreWaitingMessagesDrainState(0);
    const staleId = beginMeshcoreSilentBulkAttempt();
    const currentId = beginMeshcoreSilentBulkAttempt();
    expect(isMeshcoreSilentBulkAttemptCurrent(staleId)).toBe(false);
    expect(isMeshcoreSilentBulkAttemptCurrent(currentId)).toBe(true);
    abandonMeshcoreSilentBulkAttempt(staleId);
    expect(isMeshcoreSilentBulkAttemptCurrent(currentId)).toBe(true);
  });

  it('does not recycle silent bulk attempt ids across lifecycle reset', () => {
    resetMeshcoreWaitingMessagesDrainState(0);
    const oldId = beginMeshcoreSilentBulkAttempt();
    expect(isMeshcoreSilentBulkAttemptCurrent(oldId)).toBe(true);
    resetMeshcoreWaitingMessagesDrainState(0);
    expect(isMeshcoreSilentBulkAttemptCurrent(oldId)).toBe(false);
    const newId = beginMeshcoreSilentBulkAttempt();
    expect(newId).not.toBe(oldId);
    expect(isMeshcoreSilentBulkAttemptCurrent(oldId)).toBe(false);
    expect(isMeshcoreSilentBulkAttemptCurrent(newId)).toBe(true);
  });
});

describe('shouldRunMeshcoreWaitingMessagesPeriodicPoll', () => {
  beforeEach(() => {
    resetMeshcoreWaitingMessagesDrainState(0);
  });

  it('runs when waiting message count is positive', () => {
    expect(shouldRunMeshcoreWaitingMessagesPeriodicPoll(2, MESHCORE_WAITING_MESSAGES_POLL_MS)).toBe(
      true,
    );
  });

  it('skips when idle and no recent event 131', () => {
    expect(shouldRunMeshcoreWaitingMessagesPeriodicPoll(0, MESHCORE_WAITING_MESSAGES_POLL_MS)).toBe(
      false,
    );
  });

  it('runs after a recent event 131', () => {
    markMeshcoreMsgWaitingEvent(0);
    expect(
      shouldRunMeshcoreWaitingMessagesPeriodicPoll(0, MESHCORE_WAITING_MESSAGES_POLL_MS - 1),
    ).toBe(true);
  });
});

describe('resetMeshcoreWaitingMessagesDrainSchedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMeshcoreWaitingMessagesDrainState(0);
  });

  afterEach(() => {
    resetMeshcoreWaitingMessagesDrainSchedule();
    vi.useRealTimers();
  });

  it('invalidates in-flight silent bulk attempts so late timeouts cannot trip the next connection', () => {
    const id = beginMeshcoreSilentBulkAttempt();
    expect(isMeshcoreSilentBulkAttemptCurrent(id)).toBe(true);
    resetMeshcoreWaitingMessagesDrainSchedule();
    expect(isMeshcoreSilentBulkAttemptCurrent(id)).toBe(false);
  });

  it('cancels a pending debounced drain', async () => {
    const drain = vi.fn().mockResolvedValue(undefined);

    scheduleMeshcoreWaitingMessagesDrain(drain);
    resetMeshcoreWaitingMessagesDrainSchedule();

    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS + 5_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(drain).not.toHaveBeenCalled();
  });
});

describe('silent bulk timeout circuit breaker', () => {
  afterEach(() => {
    resetMeshcoreSilentBulkBreaker();
  });

  it('stays closed before the trip count', () => {
    expect(noteMeshcoreSilentBulkTimeout()).toBe(false);
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(false);
  });

  it('opens on the trip timeout and only reports the trip once', () => {
    for (let i = 1; i < MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP; i += 1) {
      expect(noteMeshcoreSilentBulkTimeout()).toBe(false);
    }
    expect(noteMeshcoreSilentBulkTimeout()).toBe(true);
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(true);
    expect(noteMeshcoreSilentBulkTimeout()).toBe(false);
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(true);
  });

  it('resets on successful bulk', () => {
    for (let i = 0; i < MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP; i += 1) {
      noteMeshcoreSilentBulkTimeout();
    }
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(true);
    noteMeshcoreSilentBulkSuccess();
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(false);
  });

  it('resets on drain state reset (reconnect)', () => {
    for (let i = 0; i < MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP; i += 1) {
      noteMeshcoreSilentBulkTimeout();
    }
    resetMeshcoreWaitingMessagesDrainState(0);
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(false);
  });

  it('preemptMeshcoreSilentBulkForCli invalidates in-flight bulk and skips further bulk', () => {
    const id = beginMeshcoreSilentBulkAttempt();
    expect(isMeshcoreSilentBulkAttemptCurrent(id)).toBe(true);
    preemptMeshcoreSilentBulkForCli();
    expect(isMeshcoreSilentBulkAttemptCurrent(id)).toBe(false);
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(true);
    endMeshcoreSilentBulkCliPreempt();
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(false);
  });

  it('CLI preempt does not leave the timeout circuit open after end', () => {
    preemptMeshcoreSilentBulkForCli();
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(true);
    endMeshcoreSilentBulkCliPreempt();
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(false);
    // Timeout circuit still independent
    for (let i = 0; i < MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP; i += 1) {
      noteMeshcoreSilentBulkTimeout();
    }
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(true);
  });
});

describe('shouldPreferMeshcoreSilentIncrementalDrain', () => {
  afterEach(() => {
    resetMeshcoreSilentBulkBreaker();
  });

  it('prefers incremental on TCP even when the bulk circuit is closed', () => {
    expect(shouldPreferMeshcoreSilentIncrementalDrain('tcp')).toBe(true);
    expect(shouldPreferMeshcoreSilentIncrementalDrain('ble')).toBe(false);
  });

  it('prefers incremental when the silent bulk circuit is open', () => {
    for (let i = 0; i < MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP; i += 1) {
      noteMeshcoreSilentBulkTimeout();
    }
    expect(shouldPreferMeshcoreSilentIncrementalDrain('ble')).toBe(true);
  });
});

describe('awaitMeshcoreWaitingMessagesDrainIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true immediately when drain is idle', async () => {
    await expect(awaitMeshcoreWaitingMessagesDrainIdle(() => false, 5_000)).resolves.toBe(true);
  });

  it('returns true after drain becomes idle', async () => {
    let busy = true;
    const pending = awaitMeshcoreWaitingMessagesDrainIdle(() => busy, 5_000);
    await vi.advanceTimersByTimeAsync(250);
    busy = false;
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBe(true);
  });

  it('returns false when drain stays busy until timeout', async () => {
    const pending = awaitMeshcoreWaitingMessagesDrainIdle(() => true, 1_000);
    await vi.advanceTimersByTimeAsync(1_250);
    await expect(pending).resolves.toBe(false);
  });
});

describe('circuit-open backoff intervals', () => {
  beforeEach(() => {
    resetMeshcoreWaitingMessagesDrainState(0);
  });

  it('uses 1× poll/retry when circuit is closed', () => {
    expect(meshcoreWaitingMessagesPeriodicPollIntervalMs()).toBe(MESHCORE_WAITING_MESSAGES_POLL_MS);
    expect(meshcoreWaitingMessagesCongestedRetryMs()).toBe(
      MESHCORE_WAITING_MESSAGES_CONGESTED_RETRY_MS,
    );
  });

  it('uses 4× poll/retry when silent-bulk circuit is open', () => {
    for (let i = 0; i < MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP; i += 1) {
      noteMeshcoreSilentBulkTimeout();
    }
    expect(shouldSkipMeshcoreSilentBulkGetWaitingMessages()).toBe(true);
    expect(meshcoreWaitingMessagesPeriodicPollIntervalMs()).toBe(
      MESHCORE_WAITING_MESSAGES_POLL_MS * MESHCORE_WAITING_MESSAGES_CIRCUIT_OPEN_BACKOFF_FACTOR,
    );
    expect(meshcoreWaitingMessagesCongestedRetryMs()).toBe(
      MESHCORE_WAITING_MESSAGES_CONGESTED_RETRY_MS *
        MESHCORE_WAITING_MESSAGES_CIRCUIT_OPEN_BACKOFF_FACTOR,
    );
  });

  it('restores 1× after breaker reset', () => {
    for (let i = 0; i < MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP; i += 1) {
      noteMeshcoreSilentBulkTimeout();
    }
    resetMeshcoreSilentBulkBreaker();
    expect(meshcoreWaitingMessagesPeriodicPollIntervalMs()).toBe(MESHCORE_WAITING_MESSAGES_POLL_MS);
    expect(meshcoreWaitingMessagesCongestedRetryMs()).toBe(
      MESHCORE_WAITING_MESSAGES_CONGESTED_RETRY_MS,
    );
  });

  it('circuit open at connect waits full 4× backoff from Date.now() anchor', () => {
    vi.useFakeTimers();
    const connectAt = Date.now();
    for (let i = 0; i < MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP; i += 1) {
      noteMeshcoreSilentBulkTimeout();
    }
    const lastRunAt = connectAt;
    const stretchedMs =
      MESHCORE_WAITING_MESSAGES_POLL_MS * MESHCORE_WAITING_MESSAGES_CIRCUIT_OPEN_BACKOFF_FACTOR;

    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_POLL_MS);
    expect(
      meshcoreWaitingMessagesPeriodicPollDue(
        lastRunAt,
        connectAt + MESHCORE_WAITING_MESSAGES_POLL_MS,
      ),
    ).toBe(false);

    vi.advanceTimersByTime(MESHCORE_WAITING_MESSAGES_POLL_MS * 3);
    expect(meshcoreWaitingMessagesPeriodicPollDue(lastRunAt, connectAt + stretchedMs)).toBe(true);

    expect(
      meshcoreWaitingMessagesPeriodicPollDue(0, connectAt + MESHCORE_WAITING_MESSAGES_POLL_MS),
    ).toBe(true);
    vi.useRealTimers();
  });
});
