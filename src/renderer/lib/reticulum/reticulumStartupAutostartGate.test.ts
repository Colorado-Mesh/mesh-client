// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  awaitReticulumBleCoexistenceClear,
  awaitReticulumStartupAutostartSettled,
  notifyReticulumStartupAutostartSettled,
  resetReticulumStartupAutostartGateForTests,
  skipReticulumStartupAutostartGate,
} from './reticulumStartupAutostartGate';

describe('reticulumStartupAutostartGate', () => {
  beforeEach(() => {
    resetReticulumStartupAutostartGateForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('unblocks waiters when notified', async () => {
    const wait = awaitReticulumStartupAutostartSettled(5_000);
    notifyReticulumStartupAutostartSettled();
    await expect(wait).resolves.toBeUndefined();
  });

  it('skip settles the gate immediately', async () => {
    skipReticulumStartupAutostartGate();
    await expect(awaitReticulumStartupAutostartSettled(5_000)).resolves.toBeUndefined();
  });

  it('awaitReticulumBleCoexistenceClear returns when scanOwner is not reticulum', async () => {
    Object.assign(window, {
      electronAPI: {
        bleCoexistence: {
          getState: vi.fn().mockResolvedValue({ connections: [], scanOwner: null }),
        },
      },
    });
    skipReticulumStartupAutostartGate();
    await expect(awaitReticulumBleCoexistenceClear(1_000)).resolves.toBeUndefined();
  });

  it('awaitReticulumBleCoexistenceClear waits while scanOwner is reticulum', async () => {
    const getState = vi
      .fn()
      .mockResolvedValueOnce({ connections: [], scanOwner: 'reticulum' })
      .mockResolvedValueOnce({ connections: [], scanOwner: 'reticulum' })
      .mockResolvedValue({ connections: [], scanOwner: null });
    Object.assign(window, {
      electronAPI: {
        bleCoexistence: { getState },
      },
    });
    skipReticulumStartupAutostartGate();
    const wait = awaitReticulumBleCoexistenceClear(5_000);
    await vi.advanceTimersByTimeAsync(600);
    await expect(wait).resolves.toBeUndefined();
    expect(getState.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
