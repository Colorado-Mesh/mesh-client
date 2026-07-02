/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  pickReticulumLocalHealthPollMs,
  RETICULUM_LOCAL_HEALTH_BURST_DELAYS_MS,
  RETICULUM_LOCAL_HEALTH_FAST_POLL_MS,
  RETICULUM_LOCAL_HEALTH_POLL_MS,
  scheduleReticulumLocalInterfaceBurst,
} from './reticulumLocalInterfaceRefresh';

describe('reticulumLocalInterfaceRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses fast poll when local interface alerts exist', () => {
    expect(
      pickReticulumLocalHealthPollMs(
        [
          {
            id: 'nv0n2',
            name: 'NV0N2',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: 'ble://aa:bb',
          },
        ],
        [],
      ),
    ).toBe(RETICULUM_LOCAL_HEALTH_FAST_POLL_MS);
  });

  it('uses slow poll when all local interfaces are healthy', () => {
    expect(
      pickReticulumLocalHealthPollMs(
        [
          {
            id: 'nv0n2',
            name: 'NV0N2',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: 'ble://aa:bb',
          },
        ],
        [],
      ),
    ).toBe(RETICULUM_LOCAL_HEALTH_POLL_MS);
  });

  it('runs burst refresh on configured delays', () => {
    const refresh = vi.fn();
    const cancel = scheduleReticulumLocalInterfaceBurst(refresh);
    let elapsed = 0;
    for (const delay of RETICULUM_LOCAL_HEALTH_BURST_DELAYS_MS) {
      vi.advanceTimersByTime(delay - elapsed);
      elapsed = delay;
      expect(refresh).toHaveBeenCalledTimes(
        RETICULUM_LOCAL_HEALTH_BURST_DELAYS_MS.indexOf(delay) + 1,
      );
    }
    cancel();
  });
});
