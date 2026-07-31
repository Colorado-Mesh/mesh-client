import { describe, expect, it } from 'vitest';

import {
  computeVitestMaxWorkers,
  MAX_VITEST_CPU_COUNT,
  MIN_VITEST_WORKERS,
  NODE_WORKER_CPU_RATIO,
  RENDERER_UI_CPU_RATIO,
  resolveVitestProjectGroupOrder,
  resolveVitestProjectMaxWorkers,
  VITEST_CORE_DEPS,
  VITEST_SERVER_INLINE_DEPS,
} from './vitest.harness.mts';

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
    expect(computeVitestMaxWorkers(MAX_VITEST_CPU_COUNT + 64, 0.01)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(1, 0.01)).toBe(MIN_VITEST_WORKERS);
  });

  it('computeVitestMaxWorkers caps ratio above 1', () => {
    expect(computeVitestMaxWorkers(8, 2)).toBe(8);
    expect(computeVitestMaxWorkers(4, 1.5)).toBe(4);
    expect(computeVitestMaxWorkers(MAX_VITEST_CPU_COUNT + 64, 2)).toBe(MAX_VITEST_CPU_COUNT);
  });

  it('computeVitestMaxWorkers caps cpuCount above MAX_VITEST_CPU_COUNT', () => {
    expect(computeVitestMaxWorkers(MAX_VITEST_CPU_COUNT + 64, RENDERER_UI_CPU_RATIO)).toBe(
      Math.floor(MAX_VITEST_CPU_COUNT * RENDERER_UI_CPU_RATIO),
    );
    expect(computeVitestMaxWorkers(MAX_VITEST_CPU_COUNT + 64, NODE_WORKER_CPU_RATIO)).toBe(
      Math.floor(MAX_VITEST_CPU_COUNT * NODE_WORKER_CPU_RATIO),
    );
    expect(computeVitestMaxWorkers(MAX_VITEST_CPU_COUNT + 10, 0.9)).toBe(
      Math.floor(MAX_VITEST_CPU_COUNT * 0.9),
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

  it('MIN_VITEST_WORKERS is a positive integer', () => {
    expect(Number.isInteger(MIN_VITEST_WORKERS)).toBe(true);
    expect(MIN_VITEST_WORKERS).toBeGreaterThan(0);
  });

  it('computeVitestMaxWorkers with ratio exactly 1.0', () => {
    expect(computeVitestMaxWorkers(8, 1)).toBe(8);
    expect(computeVitestMaxWorkers(1, 1)).toBe(MIN_VITEST_WORKERS);
    expect(computeVitestMaxWorkers(MIN_VITEST_WORKERS, 1)).toBe(MIN_VITEST_WORKERS);
  });

  it('computeVitestMaxWorkers at exactly MAX_VITEST_CPU_COUNT boundary', () => {
    expect(computeVitestMaxWorkers(MAX_VITEST_CPU_COUNT, 1)).toBe(MAX_VITEST_CPU_COUNT);
    expect(computeVitestMaxWorkers(MAX_VITEST_CPU_COUNT, RENDERER_UI_CPU_RATIO)).toBe(
      Math.floor(MAX_VITEST_CPU_COUNT * RENDERER_UI_CPU_RATIO),
    );
  });

  it('resolveVitestProjectGroupOrder runs all projects in parallel by default', () => {
    expect(resolveVitestProjectGroupOrder('renderer-ui')).toBe(0);
    expect(resolveVitestProjectGroupOrder('renderer-logic')).toBe(0);
    expect(resolveVitestProjectGroupOrder('main')).toBe(0);
  });

  it('resolveVitestProjectGroupOrder serializes jsdom before node when VITEST_SEQUENTIAL_PROJECTS=1', () => {
    const prev = process.env.VITEST_SEQUENTIAL_PROJECTS;
    process.env.VITEST_SEQUENTIAL_PROJECTS = '1';
    try {
      expect(resolveVitestProjectGroupOrder('renderer-ui')).toBe(0);
      expect(resolveVitestProjectGroupOrder('renderer-logic')).toBe(1);
      expect(resolveVitestProjectGroupOrder('main')).toBe(1);
    } finally {
      if (prev === undefined) {
        Reflect.deleteProperty(process.env, 'VITEST_SEQUENTIAL_PROJECTS');
      } else {
        process.env.VITEST_SEQUENTIAL_PROJECTS = prev;
      }
    }
  });

  it('resolveVitestProjectMaxWorkers uses renderer-ui pool size for all projects in parallel mode', () => {
    const prev = process.env.VITEST_SEQUENTIAL_PROJECTS;
    Reflect.deleteProperty(process.env, 'VITEST_SEQUENTIAL_PROJECTS');
    try {
      const uiWorkers = resolveVitestProjectMaxWorkers('renderer-ui', 8);
      expect(resolveVitestProjectMaxWorkers('renderer-logic', 8)).toBe(uiWorkers);
      expect(resolveVitestProjectMaxWorkers('main', 8)).toBe(uiWorkers);
    } finally {
      if (prev === undefined) {
        Reflect.deleteProperty(process.env, 'VITEST_SEQUENTIAL_PROJECTS');
      } else {
        process.env.VITEST_SEQUENTIAL_PROJECTS = prev;
      }
    }
  });

  it('resolveVitestProjectMaxWorkers uses node pool size for logic/main when VITEST_SEQUENTIAL_PROJECTS=1', () => {
    const prev = process.env.VITEST_SEQUENTIAL_PROJECTS;
    process.env.VITEST_SEQUENTIAL_PROJECTS = '1';
    try {
      expect(resolveVitestProjectMaxWorkers('renderer-ui', 8)).toBe(4);
      expect(resolveVitestProjectMaxWorkers('renderer-logic', 8)).toBe(6);
      expect(resolveVitestProjectMaxWorkers('main', 8)).toBe(6);
    } finally {
      if (prev === undefined) {
        Reflect.deleteProperty(process.env, 'VITEST_SEQUENTIAL_PROJECTS');
      } else {
        process.env.VITEST_SEQUENTIAL_PROJECTS = prev;
      }
    }
  });
});
