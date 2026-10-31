import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COI_MEMORY_MAX_SAMPLES,
  COI_MEMORY_MAX_VISIBILITY_SAMPLES,
  createCoiMemorySampler,
} from './coiMemorySampler';
import { RENDERER_MEMORY_VISIBILITY_SETTLE_MS } from './timeConstants';
import { withMockedConsoleWarn } from './vitestConsoleMock';

function setup({
  isolated = true,
  supported = true,
  processSupported = false,
  visible = true,
  jsHeap,
  domNodes,
}: {
  isolated?: boolean;
  supported?: boolean;
  processSupported?: boolean;
  visible?: boolean;
  jsHeap?: { used: number; total: number };
  domNodes?: number;
} = {}) {
  const measure = vi.fn<() => Promise<{ bytes: number }>>().mockResolvedValue({ bytes: 100 });
  const measureProcess = vi
    .fn<() => Promise<{ bytes: number }>>()
    .mockResolvedValue({ bytes: 1024 });
  let onAuto:
    ((sample: { at: number; bytes: number; source?: 'renderer-process' }) => void) | undefined;
  let onVisibility: (() => void) | undefined;
  const unsubscribeAuto = vi.fn();
  const unsubscribeVisibility = vi.fn();
  const pendingSettle = new Map<number, { fn: () => void; ms: number }>();
  let nextSettleId = 1;
  const sampler = createCoiMemorySampler({
    isIsolated: () => isolated,
    getMeasure: () => (supported ? measure : undefined),
    getProcessMeasure: () => (processSupported ? measureProcess : undefined),
    getJsHeap: jsHeap ? () => jsHeap : undefined,
    getDomNodeCount: domNodes != null ? () => domNodes : undefined,
    isVisible: () => visible,
    onVisibilityChange: (listener) => {
      onVisibility = listener;
      return unsubscribeVisibility;
    },
    onAutoSample: (listener) => {
      onAuto = listener;
      return unsubscribeAuto;
    },
    now: () => Date.now(),
    scheduleSettle: (fn, ms) => {
      const id = nextSettleId++;
      pendingSettle.set(id, { fn, ms });
      return id;
    },
    clearSettle: (id) => {
      pendingSettle.delete(id as number);
    },
  });
  return {
    sampler,
    measure,
    measureProcess,
    unsubscribeAuto,
    unsubscribeVisibility,
    pendingSettle,
    pushAuto: (sample: { at: number; bytes: number; source?: 'renderer-process' }) => {
      onAuto?.(sample);
    },
    setVisible: (value: boolean) => {
      visible = value;
      onVisibility?.();
    },
    flushSettle: () => {
      const entry = [...pendingSettle.entries()][0];
      expect(entry).toBeDefined();
      const [id, job] = entry as [number, { fn: () => void; ms: number }];
      expect(job.ms).toBe(RENDERER_MEMORY_VISIBILITY_SETTLE_MS);
      pendingSettle.delete(id);
      job.fn();
    },
  };
}

describe('COI renderer memory sampler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not arm an automatic timer; main owns the 2h cadence', () => {
    const { sampler, measure } = setup();
    const stop = sampler.start();
    expect(vi.getTimerCount()).toBe(0);
    void vi.advanceTimersByTimeAsync(60_000);
    expect(measure).not.toHaveBeenCalled();
    stop();
  });

  it.each([
    { isolated: false, supported: true, processSupported: false },
    { isolated: true, supported: false, processSupported: false },
  ])('does not sample without a usable API: %j', async (availability) => {
    const { sampler, measure } = setup(availability);
    expect(await sampler.sampleNow()).toBeNull();
    expect(measure).not.toHaveBeenCalled();
    expect(sampler.getSnapshot()).toMatchObject({
      crossOriginIsolated: availability.isolated,
      supported: availability.supported || availability.processSupported,
      samples: [],
    });
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

  it('attaches JS heap and DOM counts when available', async () => {
    const { sampler } = setup({
      processSupported: true,
      supported: false,
      jsHeap: { used: 50_000_000, total: 80_000_000 },
      domNodes: 1234,
    });
    const sample = await sampler.sampleNow();
    expect(sample).toMatchObject({
      bytes: 1024,
      source: 'renderer-process',
      jsHeapBytes: 50_000_000,
      totalJsHeapBytes: 80_000_000,
      domNodes: 1234,
    });
  });

  it('keeps a bounded history of totals without retaining browser attribution', async () => {
    let now = 1_000;
    const measure = vi.fn<() => Promise<{ bytes: number }>>().mockResolvedValue({ bytes: 100 });
    const sampler = createCoiMemorySampler({
      isIsolated: () => true,
      getMeasure: () => measure,
      isVisible: () => true,
      now: () => now,
    });
    const listener = vi.fn();
    const unsubscribe = sampler.subscribe(listener);
    for (let index = 0; index < COI_MEMORY_MAX_SAMPLES + 3; index += 1) {
      measure.mockResolvedValueOnce({ bytes: index });
      now += 1;
      await sampler.sampleNow();
    }
    expect(sampler.getSnapshot().samples).toHaveLength(COI_MEMORY_MAX_SAMPLES);
    expect(sampler.getSnapshot().samples[0]).toEqual({ at: 1_004, bytes: 3 });
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

  it('ingests main auto-samples into the ring and enriches with live diagnostics', () => {
    const { sampler, measure, measureProcess, pushAuto, unsubscribeAuto } = setup({
      processSupported: true,
      jsHeap: { used: 11, total: 22 },
      domNodes: 9,
    });
    const stop = sampler.start();
    pushAuto({ at: 100, bytes: 2_000_000, source: 'renderer-process' });
    expect(measure).not.toHaveBeenCalled();
    expect(measureProcess).not.toHaveBeenCalled();
    expect(sampler.getSnapshot().samples).toEqual([
      {
        at: 100,
        bytes: 2_000_000,
        source: 'renderer-process',
        jsHeapBytes: 11,
        totalJsHeapBytes: 22,
        domNodes: 9,
      },
    ]);
    stop();
    expect(unsubscribeAuto).toHaveBeenCalledTimes(1);
  });

  it('samples immediately on show and again after the settle delay', async () => {
    const { sampler, measureProcess, setVisible, flushSettle, pendingSettle } = setup({
      supported: false,
      processSupported: true,
      visible: false,
    });
    const stop = sampler.start();
    expect(await sampler.sampleNow()).toBeNull();
    setVisible(true);
    await vi.waitFor(() => {
      expect(measureProcess).toHaveBeenCalledTimes(1);
      expect(sampler.getSnapshot().sampling).toBe(false);
    });
    expect(pendingSettle.size).toBe(1);
    flushSettle();
    await vi.waitFor(() => {
      expect(measureProcess).toHaveBeenCalledTimes(2);
    });
    stop();
    expect(pendingSettle.size).toBe(0);
  });

  it('keeps main auto-samples when visibility cycles fill the ring', async () => {
    const { sampler, measureProcess, setVisible, flushSettle, pushAuto } = setup({
      supported: false,
      processSupported: true,
      visible: false,
    });
    const stop = sampler.start();
    const autoCount = COI_MEMORY_MAX_SAMPLES - 2;
    for (let i = 0; i < autoCount; i += 1) {
      pushAuto({ at: 1_000 + i, bytes: 1_000_000 + i, source: 'renderer-process' });
    }
    expect(sampler.getSnapshot().samples).toHaveLength(autoCount);
    for (let cycle = 0; cycle < COI_MEMORY_MAX_VISIBILITY_SAMPLES; cycle += 1) {
      setVisible(true);
      await vi.waitFor(() => {
        expect(measureProcess).toHaveBeenCalled();
        expect(sampler.getSnapshot().sampling).toBe(false);
      });
      flushSettle();
      await vi.waitFor(() => {
        expect(sampler.getSnapshot().sampling).toBe(false);
      });
      setVisible(false);
      measureProcess.mockClear();
    }
    const samples = sampler.getSnapshot().samples;
    expect(samples.some((sample) => sample.at === 1_000 && !sample.visibility)).toBe(true);
    expect(samples.filter((sample) => sample.visibility).length).toBeLessThanOrEqual(
      COI_MEMORY_MAX_VISIBILITY_SAMPLES,
    );
    expect(samples.length).toBeLessThanOrEqual(COI_MEMORY_MAX_SAMPLES);
    stop();
  });

  it('still samples on show even when a main auto-sample arrived recently', async () => {
    const { sampler, measureProcess, setVisible, pushAuto } = setup({
      supported: false,
      processSupported: true,
      visible: false,
    });
    const stop = sampler.start();
    pushAuto({ at: Date.now(), bytes: 2_000_000, source: 'renderer-process' });
    setVisible(true);
    await vi.waitFor(() => {
      expect(measureProcess).toHaveBeenCalledTimes(1);
    });
    expect(sampler.getSnapshot().samples.at(-1)?.visibility).toBe(true);
    stop();
  });

  it('cancels settle sampling when hidden again or stopped', async () => {
    const { sampler, setVisible, pendingSettle, unsubscribeVisibility } = setup({
      supported: false,
      processSupported: true,
      visible: false,
    });
    const stop = sampler.start();
    setVisible(true);
    await Promise.resolve();
    expect(pendingSettle.size).toBe(1);
    setVisible(false);
    expect(pendingSettle.size).toBe(0);
    setVisible(true);
    await Promise.resolve();
    expect(pendingSettle.size).toBe(1);
    stop();
    expect(pendingSettle.size).toBe(0);
    expect(unsubscribeVisibility).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid main auto-samples', () => {
    const { sampler, pushAuto } = setup();
    sampler.start();
    pushAuto({ at: 1, bytes: 0, source: 'renderer-process' });
    pushAuto({ at: NaN, bytes: 100, source: 'renderer-process' });
    expect(sampler.getSnapshot().samples).toEqual([]);
  });

  it('does not publish after a pending measurement is stopped', async () => {
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
  });

  it('keeps one auto-sample subscription until the last owner stops', () => {
    const { sampler, unsubscribeAuto } = setup();
    const stopFirst = sampler.start();
    const stopSecond = sampler.start();
    expect(unsubscribeAuto).not.toHaveBeenCalled();
    stopFirst();
    stopFirst();
    expect(unsubscribeAuto).not.toHaveBeenCalled();
    stopSecond();
    expect(unsubscribeAuto).toHaveBeenCalledTimes(1);
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
    expect(sampler.getSnapshot().supported).toBe(true);
    await sampler.sampleNow();
    expect(measure).not.toHaveBeenCalled();
    expect(measureProcess).toHaveBeenCalledTimes(1);
    expect(sampler.getSnapshot().samples).toEqual([
      { at: Date.now(), bytes: 1024, source: 'renderer-process' },
    ]);
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

  it('gates manual sampling while the window is hidden', async () => {
    const { sampler, measureProcess } = setup({
      visible: false,
      supported: false,
      processSupported: true,
    });
    expect(await sampler.sampleNow()).toBeNull();
    expect(measureProcess).not.toHaveBeenCalled();
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
