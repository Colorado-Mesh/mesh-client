/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('longTaskProbe', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('is a no-op when PerformanceObserver is missing', async () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const { startLongTaskProbe, stopLongTaskProbe } = await import('./longTaskProbe');
    const { clearRendererTimings, getRendererTimingsSnapshot, setRendererTimingsEnabled } =
      await import('./rendererTimings');
    clearRendererTimings();
    setRendererTimingsEnabled(true);
    expect(() => {
      startLongTaskProbe();
    }).not.toThrow();
    expect(getRendererTimingsSnapshot().samples).toHaveLength(0);
    stopLongTaskProbe();
  });

  it('ignores longtask entries under 200 ms', async () => {
    let observerCb: PerformanceObserverCallback | null = null;
    class FakePerformanceObserver {
      static supportedEntryTypes = ['longtask'];
      constructor(cb: PerformanceObserverCallback) {
        observerCb = cb;
      }
      observe(): void {
        // stub
      }
      disconnect(): void {
        // stub
      }
    }
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);

    const { startLongTaskProbe, stopLongTaskProbe } = await import('./longTaskProbe');
    const { clearRendererTimings, getRendererTimingsSnapshot, setRendererTimingsEnabled } =
      await import('./rendererTimings');
    clearRendererTimings();
    setRendererTimingsEnabled(true);
    startLongTaskProbe();
    expect(observerCb).not.toBeNull();
    observerCb!(
      {
        getEntries: () => [{ duration: 150, entryType: 'longtask', name: 'self', startTime: 0 }],
      } as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    expect(getRendererTimingsSnapshot().samples).toHaveLength(0);
    stopLongTaskProbe();
  });

  it('records longTask samples at or above 200 ms', async () => {
    let observerCb: PerformanceObserverCallback | null = null;
    class FakePerformanceObserver {
      static supportedEntryTypes = ['longtask'];
      constructor(cb: PerformanceObserverCallback) {
        observerCb = cb;
      }
      observe(): void {
        // stub
      }
      disconnect(): void {
        // stub
      }
    }
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);

    const { startLongTaskProbe, stopLongTaskProbe } = await import('./longTaskProbe');
    const { clearRendererTimings, getRendererTimingsSnapshot, setRendererTimingsEnabled } =
      await import('./rendererTimings');
    clearRendererTimings();
    setRendererTimingsEnabled(true);
    startLongTaskProbe();
    observerCb!(
      {
        getEntries: () => [{ duration: 250.4, entryType: 'longtask', name: 'self', startTime: 0 }],
      } as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    expect(getRendererTimingsSnapshot().samples).toEqual([
      expect.objectContaining({ name: 'longTask', durationMs: 250 }),
    ]);
    stopLongTaskProbe();
  });
});
