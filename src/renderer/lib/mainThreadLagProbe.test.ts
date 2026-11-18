/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('mainThreadLagProbe', () => {
  afterEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  it('returns empty snapshot when never started', async () => {
    vi.doMock('./perfTrace', () => ({ PERF_TRACE_ENABLED: false }));
    const { mainThreadLagSnapshot, resetMainThreadLagProbe, stopMainThreadLagProbe } =
      await import('./mainThreadLagProbe');
    resetMainThreadLagProbe();
    stopMainThreadLagProbe();
    expect(mainThreadLagSnapshot().sampleCount).toBe(0);
  });

  it('records lag samples when perf tracing is enabled', async () => {
    vi.useFakeTimers();
    vi.doMock('./perfTrace', () => ({ PERF_TRACE_ENABLED: true }));
    const {
      mainThreadLagSnapshot,
      resetMainThreadLagProbe,
      startMainThreadLagProbe,
      stopMainThreadLagProbe,
    } = await import('./mainThreadLagProbe');
    resetMainThreadLagProbe();
    startMainThreadLagProbe();
    await vi.advanceTimersByTimeAsync(350);
    const snap = mainThreadLagSnapshot();
    expect(snap.sampleCount).toBeGreaterThan(0);
    expect(snap.maxMs).toBeGreaterThanOrEqual(0);
    stopMainThreadLagProbe();
  });
});
