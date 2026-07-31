import { describe, expect, it } from 'vitest';

import { clampQueryLimit } from './clampQueryLimit';

describe('clampQueryLimit', () => {
  it('returns a finite in-range value unchanged', () => {
    expect(clampQueryLimit(50, { default: 200, max: 10_000 })).toBe(50);
    expect(clampQueryLimit('50', { default: 200, max: 10_000 })).toBe(50);
  });

  it('uses default when value is missing or non-numeric', () => {
    expect(clampQueryLimit(undefined, { default: 200, max: 10_000 })).toBe(200);
    expect(clampQueryLimit(null, { default: 500, max: 10_000 })).toBe(500);
    expect(clampQueryLimit('', { default: 500, max: 10_000 })).toBe(500);
    expect(clampQueryLimit('abc', { default: 500, max: 10_000 })).toBe(500);
    expect(clampQueryLimit(0, { default: 1000, max: 10_000 })).toBe(1000);
    expect(clampQueryLimit(NaN, { default: 1000, max: 10_000 })).toBe(1000);
  });

  it('clamps below min (default 1) and above max', () => {
    expect(clampQueryLimit(-5, { default: 200, max: 10_000 })).toBe(1);
    expect(clampQueryLimit(99_999, { default: 200, max: 10_000 })).toBe(10_000);
    expect(clampQueryLimit(-5, { default: 200, min: 10, max: 100 })).toBe(10);
  });
});
