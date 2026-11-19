/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { beginProtocolSwitchTiming } from './protocolSwitchTiming';
import {
  clearRendererTimings,
  getRendererTimingsSnapshot,
  setRendererTimingsEnabled,
} from './rendererTimings';

describe('protocolSwitchTiming', () => {
  beforeEach(() => {
    clearRendererTimings();
    setRendererTimingsEnabled(true);
    vi.useFakeTimers({ toFake: ['performance'] });
  });

  afterEach(() => {
    clearRendererTimings();
    setRendererTimingsEnabled(true);
    vi.useRealTimers();
  });

  it('records urgent and commit durations from click time and runs commit work', () => {
    const handle = beginProtocolSwitchTiming();
    vi.advanceTimersByTime(12);
    handle.markUrgent();
    vi.advanceTimersByTime(40);
    const work = vi.fn();
    handle.markCommit(work);

    expect(work).toHaveBeenCalledTimes(1);
    const names = getRendererTimingsSnapshot().samples.map((s) => s.name);
    expect(names).toContain('protocolSwitch:urgent');
    expect(names).toContain('protocolSwitch:commit');
    const urgent = getRendererTimingsSnapshot().samples.find(
      (s) => s.name === 'protocolSwitch:urgent',
    );
    expect(urgent?.durationMs).toBe(12);
  });
});
