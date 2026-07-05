import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  markMeshcoreCompanionTx,
  resetMeshcoreWaitingMessagesDrainSchedule,
  resetMeshcoreWaitingMessagesDrainState,
  scheduleMeshcoreWaitingMessagesDrain,
  shouldActivateWaitingMessagesBanner,
  waitingMessagesDrainTimeoutMs,
} from './meshcoreWaitingMessagesDrain';
import {
  MESHCORE_WAITING_MESSAGES_AFTER_TX_DEFER_MS,
  MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS,
  MESHCORE_WAITING_MESSAGES_SILENT_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_SYNC_TIMEOUT_MS,
} from './timeConstants';

describe('waitingMessagesDrainTimeoutMs', () => {
  it('uses the silent timeout for auto-drains', () => {
    expect(waitingMessagesDrainTimeoutMs(false)).toBe(MESHCORE_WAITING_MESSAGES_SILENT_TIMEOUT_MS);
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
