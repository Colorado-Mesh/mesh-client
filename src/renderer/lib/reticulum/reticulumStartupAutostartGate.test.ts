// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETICULUM_BLE_CONNECT_GRACE_MS } from './reticulumLocalInterfaceRefresh';
import {
  awaitReticulumBleCoexistenceClear,
  awaitReticulumStartupAutostartSettled,
  notifyReticulumStartupAutostartSettled,
  resetReticulumStartupAutostartGateForTests,
  RETICULUM_BLE_COEXISTENCE_CLEAR_MAX_MS,
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

  it('defaults coexistence clear wait to cover BLE connect grace', () => {
    expect(RETICULUM_BLE_COEXISTENCE_CLEAR_MAX_MS).toBe(RETICULUM_BLE_CONNECT_GRACE_MS + 5_000);
  });

  it('awaitReticulumBleCoexistenceClear returns when scanOwner is not reticulum', async () => {
    Object.assign(window, {
      electronAPI: {
        bleCoexistence: {
          getState: vi.fn().mockResolvedValue({
            connections: [],
            scanOwner: null,
            nobleYieldDecisionPending: false,
          }),
        },
      },
    });
    skipReticulumStartupAutostartGate();
    await expect(awaitReticulumBleCoexistenceClear(1_000)).resolves.toBeUndefined();
  });

  it('awaitReticulumBleCoexistenceClear waits while scanOwner is reticulum', async () => {
    const getState = vi
      .fn()
      .mockResolvedValueOnce({
        connections: [],
        scanOwner: 'reticulum',
        nobleYieldDecisionPending: false,
      })
      .mockResolvedValueOnce({
        connections: [],
        scanOwner: 'reticulum',
        nobleYieldDecisionPending: false,
      })
      .mockResolvedValue({
        connections: [],
        scanOwner: null,
        nobleYieldDecisionPending: false,
      });
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

  it('does not resolve while nobleYieldDecisionPending even if scanOwner is null', async () => {
    const getState = vi
      .fn()
      .mockResolvedValueOnce({
        connections: [],
        scanOwner: null,
        nobleYieldDecisionPending: true,
      })
      .mockResolvedValueOnce({
        connections: [],
        scanOwner: null,
        nobleYieldDecisionPending: true,
      })
      .mockResolvedValue({
        connections: [],
        scanOwner: null,
        nobleYieldDecisionPending: false,
      });
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
