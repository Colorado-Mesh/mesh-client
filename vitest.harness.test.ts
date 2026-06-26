import { describe, expect, it } from 'vitest';

import {
  computeVitestMaxWorkers,
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

  it('renderer-ui uses a lower CPU ratio than node workers', () => {
    expect(RENDERER_UI_CPU_RATIO).toBeLessThan(NODE_WORKER_CPU_RATIO);
  });

  it('VITEST_CORE_DEPS is a subset of VITEST_SERVER_INLINE_DEPS', () => {
    for (const dep of VITEST_CORE_DEPS) {
      expect(VITEST_SERVER_INLINE_DEPS).toContain(dep);
    }
  });
});
