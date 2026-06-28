import { describe, expect, it } from 'vitest';

import {
  computeVitestMaxWorkers,
  MAX_VITEST_CPU_COUNT,
  MIN_VITEST_WORKERS,
  NODE_WORKER_CPU_RATIO,
  RENDERER_UI_CPU_RATIO,
  VITEST_CORE_DEPS,
  VITEST_SERVER_INLINE_DEPS,
} from './vitest.harness';

describe('vitest.harness', () => {
  it('computeVitestMaxWorkers applies ratio and MIN_VITEST_WORKERS floor', () => {
    expect(computeVitestMaxWorkers(1, RENDERER_UI_CPU_RATIO)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(8, RENDERER_UI_CPU_RATIO)).toBe(4);
    expect(computeVitestMaxWorkers(8, NODE_WORKER_CPU_RATIO)).toBe(6);
  });

  it('computeVitestMaxWorkers returns MIN_VITEST_WORKERS for invalid inputs', () => {
    expect(computeVitestMaxWorkers(0, RENDERER_UI_CPU_RATIO)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(-4, NODE_WORKER_CPU_RATIO)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(8, 0)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(8, -0.5)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(Number.NaN, RENDERER_UI_CPU_RATIO)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(8, Number.NaN)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(8, Number.POSITIVE_INFINITY)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(8, Number.NEGATIVE_INFINITY)).toBe(MIN_VITEST_WORKERS);
  });

  it('computeVitestMaxWorkers floors very small ratios to MIN_VITEST_WORKERS', () => {
    expect(computeVitestMaxWorkers(MAX_VITEST_CPU_COUNT, 0.01)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(1, 0.01)).toBe(MIN_VITEST_WORKERS);
  });

  it('computeVitestMaxWorkers caps ratio above 1', () => {
    expect(computeVitestMaxWorkers(8, 2)).toBe(8);
    expect(computeVitestMaxWorkers(4, 1.5)).toBe(4);
  });

  it('computeVitestMaxWorkers caps cpuCount above MAX_VITEST_CPU_COUNT', () => {
    expect(computeVitestMaxWorkers(MAX_VITEST_CPU_COUNT + 64, RENDERER_UI_CPU_RATIO)).toBe(
      Math.floor(MAX_VITEST_CPU_COUNT * RENDERER_UI_CPU_RATIO),
    );
    expect(computeVitestMaxWorkers(MAX_VITEST_CPU_COUNT + 64, NODE_WORKER_CPU_RATIO)).toBe(
      Math.floor(MAX_VITEST_CPU_COUNT * NODE_WORKER_CPU_RATIO),
    );
  });

  it('renderer-ui uses a lower CPU ratio than node workers', () => {
    expect(RENDERER_UI_CPU_RATIO).toBeLessThan(NODE_WORKER_CPU_RATIO);
  });

  it('VITEST_CORE_DEPS is a subset of VITEST_SERVER_INLINE_DEPS', () => {
    for (const dep of VITEST_CORE_DEPS) {
      expect(VITEST_SERVER_INLINE_DEPS).toContain(dep);
    }
  });
});
