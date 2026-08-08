import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { raceWithDeadline } from './bleReconnectHelper';
import {
  type LoraRfReconnectAttemptDeps,
  runLoraRfReconnectAttempt,
} from './loraRfReconnectAttempt';
import { createRfReconnectController } from './rfReconnectController';
import { loadRendererLibSource } from './sourceContractTestHelpers';
import { setSystemSuspended } from './systemPowerState';
import { NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS } from './timeConstants';

vi.mock('./bleReconnectHelper', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('./bleReconnectHelper')>();
  return {
    ...actual,
    raceWithDeadline: vi.fn(actual.raceWithDeadline),
  };
});

interface TestParams {
  type: 'ble' | 'serial' | 'tcp';
}

function boolRef(initial = false) {
  let value = initial;
  return {
    get: () => value,
    set: (next: boolean) => {
      value = next;
    },
  };
}

function numberRef(initial = 0) {
  let value = initial;
  return {
    get: () => value,
    set: (next: number) => {
      value = next;
    },
  };
}

describe('runLoraRfReconnectAttempt', () => {
  let microtasks: (() => void)[];
  let controller: ReturnType<typeof createRfReconnectController>;
  let isReconnecting: ReturnType<typeof boolRef>;
  let deferredReconnect: ReturnType<typeof boolRef>;
  let connectInFlight: ReturnType<typeof boolRef>;
  let bleConnectInProgress: ReturnType<typeof boolRef>;
  let generation: ReturnType<typeof numberRef>;
  let attemptCounter: ReturnType<typeof numberRef>;
  let scheduleAttempt: ReturnType<typeof vi.fn<() => void>>;
  let setReconnectingUi: ReturnType<typeof vi.fn<(attempt: number) => void>>;
  let setDisconnectedUi: ReturnType<typeof vi.fn<(opts?: { connectionLoss?: boolean }) => void>>;
  let onExhausted: ReturnType<typeof vi.fn<(params: TestParams) => Promise<void>>>;
  let onMissingParams: ReturnType<typeof vi.fn<() => void>>;
  let runOpenAndAttach: ReturnType<
    typeof vi.fn<(ctx: unknown, params: TestParams) => Promise<void>>
  >;
  let onAttemptError: ReturnType<
    typeof vi.fn<(err: unknown, ctx: unknown) => Promise<'retry' | 'defer' | 'done'>>
  >;
  let explicitDisconnect: boolean;
  let params: TestParams | null;

  beforeEach(() => {
    vi.useFakeTimers();
    microtasks = [];
    setSystemSuspended(false);
    explicitDisconnect = false;
    params = { type: 'tcp' };
    isReconnecting = boolRef(true);
    deferredReconnect = boolRef(false);
    connectInFlight = boolRef(false);
    bleConnectInProgress = boolRef(false);
    generation = numberRef(1);
    attemptCounter = numberRef(0);
    scheduleAttempt = vi.fn<() => void>();
    setReconnectingUi = vi.fn<(attempt: number) => void>();
    setDisconnectedUi = vi.fn<(opts?: { connectionLoss?: boolean }) => void>();
    onExhausted = vi.fn<(params: TestParams) => Promise<void>>().mockResolvedValue(undefined);
    onMissingParams = vi.fn<() => void>();
    runOpenAndAttach = vi
      .fn<(ctx: unknown, params: TestParams) => Promise<void>>()
      .mockResolvedValue(undefined);
    onAttemptError = vi
      .fn<(err: unknown, ctx: unknown) => Promise<'retry' | 'defer' | 'done'>>()
      .mockResolvedValue('retry');
    controller = createRfReconnectController({
      logTag: 'test',
      scheduleMicrotask: (fn) => {
        microtasks.push(fn);
      },
    });
    controller.onLinkLost();
    generation.set(controller.generation);
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(raceWithDeadline).mockImplementation((work) => Promise.resolve(work));
  });

  afterEach(() => {
    setSystemSuspended(false);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function buildDeps(
    overrides: Partial<LoraRfReconnectAttemptDeps<TestParams>> = {},
  ): LoraRfReconnectAttemptDeps<TestParams> {
    return {
      logTag: 'test',
      controller,
      getParams: () => params,
      getTransportType: (p) => p.type,
      isBle: (p) => p.type === 'ble',
      isExplicitDisconnect: () => explicitDisconnect,
      isReconnecting,
      generation,
      attemptCounter,
      deferredReconnect,
      connectInFlight,
      bleConnectInProgress,
      scheduleAttempt,
      setReconnectingUi,
      setDisconnectedUi,
      overlapCheck: 'beforeOpening',
      disconnectIdentity: vi.fn().mockResolvedValue(undefined),
      onMissingParams,
      onExhausted,
      runOpenAndAttach,
      onAttemptError,
      ...overrides,
    };
  }

  async function runAttempt(overrides: Partial<LoraRfReconnectAttemptDeps<TestParams>> = {}) {
    const promise = runLoraRfReconnectAttempt(buildDeps(overrides));
    // Advance past exponential backoff (attempt 1 → 2000ms).
    await vi.advanceTimersByTimeAsync(2_500);
    await promise;
  }

  it('clears reconnecting and calls onMissingParams when params are null', async () => {
    params = null;
    await runLoraRfReconnectAttempt(buildDeps());
    expect(isReconnecting.get()).toBe(false);
    expect(onMissingParams).toHaveBeenCalledTimes(1);
    expect(runOpenAndAttach).not.toHaveBeenCalled();
  });

  it('returns early on explicit disconnect without opening', async () => {
    explicitDisconnect = true;
    await runLoraRfReconnectAttempt(buildDeps());
    expect(isReconnecting.get()).toBe(false);
    expect(runOpenAndAttach).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('marks exhausted and calls onExhausted when attempt budget is spent', async () => {
    attemptCounter.set(5); // RF_MAX_RECONNECT_ATTEMPTS for tcp
    await runLoraRfReconnectAttempt(buildDeps());
    expect(controller.isReconnecting).toBe(false);
    expect(onExhausted).toHaveBeenCalledWith({ type: 'tcp' });
    expect(runOpenAndAttach).not.toHaveBeenCalled();
  });

  it('runs open after backoff and bounds the attempt with raceWithDeadline', async () => {
    await runAttempt();
    expect(setReconnectingUi).toHaveBeenCalledWith(1);
    expect(runOpenAndAttach).toHaveBeenCalledTimes(1);
    expect(raceWithDeadline).toHaveBeenCalledWith(
      expect.any(Promise),
      NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS,
      expect.stringContaining('Reconnect attempt timed out after'),
    );
  });

  it('skips overlapping open before beginOpening when overlapCheck is beforeOpening', async () => {
    connectInFlight.set(true);
    await runAttempt();
    expect(runOpenAndAttach).not.toHaveBeenCalled();
    expect(deferredReconnect.get()).toBe(true);
    expect(controller.dirty).toBe(true);
  });

  it('skips overlapping open after beginOpening when overlapCheck is afterOpening', async () => {
    connectInFlight.set(true);
    const beginOpeningSpy = vi.spyOn(controller, 'beginOpening');
    await runAttempt({ overlapCheck: 'afterOpening' });
    expect(beginOpeningSpy).toHaveBeenCalled();
    expect(runOpenAndAttach).not.toHaveBeenCalled();
    expect(deferredReconnect.get()).toBe(true);
  });

  it('delay abort with deferred restart schedules the next attempt', async () => {
    const delayPromise = runLoraRfReconnectAttempt(buildDeps());
    // Abort delay by bumping generation + setting deferred while reconnecting stays true.
    await vi.advanceTimersByTimeAsync(100);
    deferredReconnect.set(true);
    generation.set(generation.get() + 1);
    await vi.advanceTimersByTimeAsync(2_500);
    await delayPromise;
    expect(scheduleAttempt).toHaveBeenCalled();
    expect(setDisconnectedUi).not.toHaveBeenCalled();
    expect(runOpenAndAttach).not.toHaveBeenCalled();
  });

  it('delay abort without deferred clears disconnected UI when cycle cancelled', async () => {
    const delayPromise = runLoraRfReconnectAttempt(buildDeps());
    await vi.advanceTimersByTimeAsync(100);
    isReconnecting.set(false);
    generation.set(generation.get() + 1);
    await vi.advanceTimersByTimeAsync(2_500);
    await delayPromise;
    expect(setDisconnectedUi).toHaveBeenCalledWith({ connectionLoss: true });
    expect(runOpenAndAttach).not.toHaveBeenCalled();
  });

  it('cancels controller and clears UI when delay returns suspended', async () => {
    setSystemSuspended(true);
    const delayPromise = runLoraRfReconnectAttempt(buildDeps());
    await vi.advanceTimersByTimeAsync(600);
    await delayPromise;
    expect(controller.isReconnecting).toBe(false);
    expect(isReconnecting.get()).toBe(false);
    expect(setDisconnectedUi).toHaveBeenCalledWith({ connectionLoss: true });
    expect(runOpenAndAttach).not.toHaveBeenCalled();
  });

  it('schedules retry from onAttemptError when action is retry', async () => {
    runOpenAndAttach.mockRejectedValue(new Error('open failed'));
    onAttemptError.mockResolvedValue('retry');
    await runAttempt();
    expect(onAttemptError).toHaveBeenCalled();
    expect(scheduleAttempt).toHaveBeenCalled();
  });

  it('does not schedule retry when onAttemptError returns defer', async () => {
    runOpenAndAttach.mockRejectedValue(new Error('setup abort'));
    onAttemptError.mockImplementation(() => {
      deferredReconnect.set(true);
      return Promise.resolve('defer' as const);
    });
    await runAttempt();
    // finally flush still schedules once when deferred is set
    expect(scheduleAttempt).toHaveBeenCalledTimes(1);
  });

  it('finally flushes deferred reconnect via scheduleAttempt (not connection-lost)', async () => {
    runOpenAndAttach.mockImplementation(() => {
      deferredReconnect.set(true);
      return Promise.resolve();
    });
    // Keep isReconnecting true after success path that only marks deferred (adapter would
    // normally clear it on success — here we simulate mid-open defer).
    await runAttempt();
    expect(scheduleAttempt).toHaveBeenCalled();
    expect(connectInFlight.get()).toBe(false);
  });

  it('sets and clears bleConnectInProgress around BLE opens', async () => {
    params = { type: 'ble' };
    let sawInFlightDuringOpen = false;
    runOpenAndAttach.mockImplementation(() => {
      sawInFlightDuringOpen = bleConnectInProgress.get();
      return Promise.resolve();
    });
    await runAttempt();
    expect(sawInFlightDuringOpen).toBe(true);
    expect(bleConnectInProgress.get()).toBe(false);
  });

  it('passes attemptActive and lateTransport into runOpenAndAttach', async () => {
    let activeDuringOpen = false;
    runOpenAndAttach.mockImplementation((ctx: unknown) => {
      activeDuringOpen = (ctx as { attemptActive: () => boolean }).attemptActive();
      return Promise.resolve();
    });
    await runAttempt();
    expect(activeDuringOpen).toBe(true);
    const ctx = runOpenAndAttach.mock.calls[0]?.[0] as {
      lateTransport: { cleanup: (id: string) => Promise<void> };
      generation: number;
    };
    expect(ctx.generation).toBe(1);
    expect(typeof ctx.lateTransport.cleanup).toBe('function');
  });
});

describe('loraRfReconnectAttempt source contracts', () => {
  it('owns raceWithDeadline budget and finally schedule flush', () => {
    const source = loadRendererLibSource('loraRfReconnectAttempt.ts');
    expect(source).toContain('raceWithDeadline');
    expect(source).toContain('NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS');
    expect(source).toContain('Reconnect attempt timed out after');
    expect(source).toContain('createBleReconnectTransportCleanup');
    expect(source).toContain('endAttempt');
    expect(source).toContain('scheduleAttempt()');
    expect(source).toContain('skip overlapping open');
    expect(source).toMatch(
      /delayResult === 'aborted'[\s\S]*?flushDeferredOrEnd[\s\S]*?setDisconnectedUi/,
    );
  });
});
