import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COI_MEMORY_MAX_SAMPLES, createCoiMemorySampler } from './coiMemorySampler';
import { COI_MEMORY_SAMPLE_INTERVAL_MS } from './timeConstants';
import { withMockedConsoleWarn } from './vitestConsoleMock';

function setup({
  isolated = true,
  supported = true,
  processSupported = false,
  visible = true,
  random = 0.5,
} = {}) {
  const measure = vi.fn<() => Promise<{ bytes: number }>>().mockResolvedValue({ bytes: 100 });
  const measureProcess = vi
    .fn<() => Promise<{ bytes: number }>>()
    .mockResolvedValue({ bytes: 1024 });
  let onVisibility: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const sampler = createCoiMemorySampler({
    isIsolated: () => isolated,
    getMeasure: () => (supported ? measure : undefined),
    getProcessMeasure: () => (processSupported ? measureProcess : undefined),
    isVisible: () => visible,
    onVisibilityChange: (listener) => {
      onVisibility = listener;
      return unsubscribe;
    },
    now: () => Date.now(),
    random: () => random,
  });
  return {
    sampler,
    measure,
    measureProcess,
    unsubscribe,
    setVisible: (value: boolean) => {
      visible = value;
      onVisibility?.();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('COI renderer memory sampler', () => {
  it.each([0, 1])('jitters the automatic interval with random value %s', async (random) => {
    const { sampler, measure } = setup({ random });
    const stop = sampler.start();
    const expectedDelay = COI_MEMORY_SAMPLE_INTERVAL_MS * (0.8 + random * 0.4);
    await vi.advanceTimersByTimeAsync(expectedDelay - 1);
    expect(measure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(measure).toHaveBeenCalledTimes(1);
    stop();
  });

  it.each([
    { isolated: false, supported: true, processSupported: false },
    { isolated: true, supported: false, processSupported: false },
  ])('does not sample without a usable API: %j', async (availability) => {
    const { sampler, measure } = setup(availability);
    const stop = sampler.start();
    expect(await sampler.sampleNow()).toBeNull();
    await vi.advanceTimersByTimeAsync(COI_MEMORY_SAMPLE_INTERVAL_MS * 2);
    expect(measure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(sampler.getSnapshot()).toMatchObject({
      crossOriginIsolated: availability.isolated,
      supported: availability.supported || availability.processSupported,
      samples: [],
    });
    stop();
  });

  it('samples process memory when not isolated but getAppMetrics is available', async () => {
    const { sampler, measure, measureProcess } = setup({
      isolated: false,
      supported: false,
      processSupported: true,
    });
    const sample = await sampler.sampleNow();
    expect(measure).not.toHaveBeenCalled();
    expect(measureProcess).toHaveBeenCalledTimes(1);
    expect(sample).toEqual({
      at: Date.now(),
      bytes: 1024,
      source: 'renderer-process',
    });
  });

  it('keeps a bounded history of totals without retaining browser attribution', async () => {
    const { sampler, measure } = setup();
    const listener = vi.fn();
    const unsubscribe = sampler.subscribe(listener);
    for (let index = 0; index < COI_MEMORY_MAX_SAMPLES + 3; index += 1) {
      measure.mockResolvedValueOnce({ bytes: index });
      await sampler.sampleNow();
    }
    expect(sampler.getSnapshot().samples).toHaveLength(COI_MEMORY_MAX_SAMPLES);
    expect(sampler.getSnapshot().samples[0]).toEqual({ at: Date.now(), bytes: 3 });
    expect(sampler.getSnapshot().samples.at(-1)?.bytes).toBe(COI_MEMORY_MAX_SAMPLES + 2);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    await sampler.sampleNow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('coalesces manual requests with an in-flight measurement', async () => {
    const { sampler, measure } = setup();
    let complete!: (result: { bytes: number }) => void;
    measure.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
    const first = sampler.sampleNow();
    const second = sampler.sampleNow();
    expect(first).toBe(second);
    expect(sampler.getSnapshot().sampling).toBe(true);
    await Promise.resolve();
    expect(measure).toHaveBeenCalledTimes(1);
    complete({ bytes: 42 });
    await first;
    expect(sampler.getSnapshot()).toMatchObject({ sampling: false, samples: [{ bytes: 42 }] });
  });

  it('pauses while hidden, resumes at a fresh interval, and cleans up on stop', async () => {
    const { sampler, measure, setVisible, unsubscribe } = setup();
    const stop = sampler.start();
    await vi.advanceTimersByTimeAsync(COI_MEMORY_SAMPLE_INTERVAL_MS - 1);
    expect(measure).not.toHaveBeenCalled();
    setVisible(false);
    expect(await sampler.sampleNow()).toBeNull();
    await vi.advanceTimersByTimeAsync(COI_MEMORY_SAMPLE_INTERVAL_MS * 2);
    expect(measure).not.toHaveBeenCalled();
    setVisible(true);
    await vi.advanceTimersByTimeAsync(COI_MEMORY_SAMPLE_INTERVAL_MS);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not publish or restart polling after a pending measurement is stopped', async () => {
    const { sampler, measure } = setup();
    let complete!: (result: { bytes: number }) => void;
    measure.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
    const stop = sampler.start();
    const pending = sampler.sampleNow();
    await Promise.resolve();
    stop();
    complete({ bytes: 100 });
    expect(await pending).toBeNull();
    expect(sampler.getSnapshot()).toMatchObject({ sampling: false, samples: [] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps one polling loop until the last owner stops', async () => {
    const { sampler, measure } = setup();
    const stopFirst = sampler.start();
    const stopSecond = sampler.start();
    expect(vi.getTimerCount()).toBe(1);
    stopFirst();
    stopFirst();
    await vi.advanceTimersByTimeAsync(COI_MEMORY_SAMPLE_INTERVAL_MS);
    expect(measure).toHaveBeenCalledTimes(1);
    stopSecond();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports failures without losing prior samples and recovers on retry', async () => {
    await withMockedConsoleWarn(async () => {
      const { sampler, measure } = setup();
      await sampler.sampleNow();
      measure.mockRejectedValueOnce(new Error('Not permitted'));
      expect(await sampler.sampleNow()).toBeNull();
      expect(sampler.getSnapshot()).toMatchObject({ failed: true, sampling: false });
      expect(sampler.getSnapshot().samples).toHaveLength(1);
      await sampler.sampleNow();
      expect(sampler.getSnapshot().failed).toBe(false);
      expect(sampler.getSnapshot().samples).toHaveLength(2);
    });
  });

  it('uses process physical memory when the browser API is absent', async () => {
    const { sampler, measure, measureProcess } = setup({
      supported: false,
      processSupported: true,
    });
    const stop = sampler.start();
    expect(sampler.getSnapshot().supported).toBe(true);
    await vi.advanceTimersByTimeAsync(COI_MEMORY_SAMPLE_INTERVAL_MS);
    expect(measure).not.toHaveBeenCalled();
    expect(measureProcess).toHaveBeenCalledTimes(1);
    expect(sampler.getSnapshot().samples).toEqual([
      { at: Date.now(), bytes: 1024, source: 'renderer-process' },
    ]);
    stop();
  });

  it('switches to process memory after SecurityError and starts a separate history', async () => {
    const { sampler, measure, measureProcess } = setup({ processSupported: true });
    await sampler.sampleNow();
    measure.mockRejectedValueOnce(new DOMException('not available', 'SecurityError'));
    expect(await sampler.sampleNow()).toEqual({
      at: Date.now(),
      bytes: 1024,
      source: 'renderer-process',
    });
    expect(sampler.getSnapshot()).toMatchObject({ failed: false, samples: [{ bytes: 1024 }] });
    expect(sampler.getSnapshot().samples).toHaveLength(1);
    await sampler.sampleNow();
    expect(measure).toHaveBeenCalledTimes(2);
    expect(measureProcess).toHaveBeenCalledTimes(2);
    expect(sampler.getSnapshot().samples).toHaveLength(2);
  });

  it('reports other browser errors rather than disguising them as a process sample', async () => {
    await withMockedConsoleWarn(async () => {
      const { sampler, measure, measureProcess } = setup({ processSupported: true });
      measure.mockRejectedValueOnce(new Error('measurement crashed'));
      expect(await sampler.sampleNow()).toBeNull();
      expect(measureProcess).not.toHaveBeenCalled();
      expect(sampler.getSnapshot()).toMatchObject({ failed: true, samples: [] });
    });
  });

  it('gates process sampling while the window is hidden', async () => {
    const { sampler, measureProcess } = setup({
      visible: false,
      supported: false,
      processSupported: true,
    });
    const stop = sampler.start();
    expect(await sampler.sampleNow()).toBeNull();
    await vi.advanceTimersByTimeAsync(COI_MEMORY_SAMPLE_INTERVAL_MS * 2);
    expect(measureProcess).not.toHaveBeenCalled();
    stop();
  });

  it('does not start a fallback measurement after the owner stops', async () => {
    const { sampler, measure, measureProcess } = setup({ processSupported: true });
    let reject!: (reason: unknown) => void;
    measure.mockImplementationOnce(() => new Promise((_resolve, fail) => (reject = fail)));
    const stop = sampler.start();
    const pending = sampler.sampleNow();
    await Promise.resolve();
    stop();
    reject(new DOMException('not available', 'SecurityError'));
    expect(await pending).toBeNull();
    expect(measureProcess).not.toHaveBeenCalled();
    expect(sampler.getSnapshot().samples).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports unavailable native metrics and retries process sampling later', async () => {
    await withMockedConsoleWarn(async () => {
      const { sampler, measure, measureProcess } = setup({ processSupported: true });
      measure.mockRejectedValueOnce(new DOMException('not available', 'SecurityError'));
      measureProcess.mockRejectedValueOnce(new Error('Renderer PID unavailable'));
      expect(await sampler.sampleNow()).toBeNull();
      expect(sampler.getSnapshot()).toMatchObject({ failed: true, samples: [] });
      await sampler.sampleNow();
      expect(sampler.getSnapshot()).toMatchObject({ failed: false, samples: [{ bytes: 1024 }] });
      expect(measure).toHaveBeenCalledTimes(1);
    });
  });

  it.each([0, NaN, Infinity, -1])('rejects invalid process memory: %s', async (bytes) => {
    await withMockedConsoleWarn(async () => {
      const { sampler, measureProcess } = setup({ supported: false, processSupported: true });
      measureProcess.mockResolvedValueOnce({ bytes });
      expect(await sampler.sampleNow()).toBeNull();
      expect(sampler.getSnapshot()).toMatchObject({ failed: true, samples: [] });
    });
  });

  it.each([NaN, Infinity, -1])('rejects an invalid browser total: %s', async (bytes) => {
    await withMockedConsoleWarn(async () => {
      const { sampler, measure } = setup();
      measure.mockResolvedValueOnce({ bytes });
      expect(await sampler.sampleNow()).toBeNull();
      expect(sampler.getSnapshot()).toMatchObject({ failed: true, samples: [] });
    });
  });
});
