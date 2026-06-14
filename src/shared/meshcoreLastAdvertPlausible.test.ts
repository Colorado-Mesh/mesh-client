import { describe, expect, it } from 'vitest';

import {
  clampMeshcoreLastAdvertSec,
  isPlausibleMeshcoreLastAdvertSec,
  MESHCORE_LAST_ADVERT_MAX_FUTURE_SKEW_SEC,
  MESHCORE_LAST_ADVERT_MIN_PLAUSIBLE_SEC,
} from './meshcoreLastAdvertPlausible';

describe('isPlausibleMeshcoreLastAdvertSec', () => {
  it('accepts epoch seconds at or above the floor', () => {
    expect(isPlausibleMeshcoreLastAdvertSec(MESHCORE_LAST_ADVERT_MIN_PLAUSIBLE_SEC)).toBe(true);
    expect(isPlausibleMeshcoreLastAdvertSec(1_781_401_111)).toBe(true);
  });

  it('rejects repeater uptime-like small values', () => {
    expect(isPlausibleMeshcoreLastAdvertSec(6)).toBe(false);
    expect(isPlausibleMeshcoreLastAdvertSec(86_444)).toBe(false);
    expect(isPlausibleMeshcoreLastAdvertSec(MESHCORE_LAST_ADVERT_MIN_PLAUSIBLE_SEC - 1)).toBe(
      false,
    );
  });

  it('rejects nullish and non-finite input', () => {
    expect(isPlausibleMeshcoreLastAdvertSec(null)).toBe(false);
    expect(isPlausibleMeshcoreLastAdvertSec(undefined)).toBe(false);
    expect(isPlausibleMeshcoreLastAdvertSec(NaN)).toBe(false);
  });
});

describe('clampMeshcoreLastAdvertSec', () => {
  const nowSec = 1_781_400_000;

  it('returns floored seconds within skew window', () => {
    expect(clampMeshcoreLastAdvertSec(nowSec + 60, nowSec)).toBe(nowSec + 60);
    expect(
      clampMeshcoreLastAdvertSec(nowSec + MESHCORE_LAST_ADVERT_MAX_FUTURE_SKEW_SEC, nowSec),
    ).toBe(nowSec + MESHCORE_LAST_ADVERT_MAX_FUTURE_SKEW_SEC);
  });

  it('clamps timestamps beyond skew to nowSec', () => {
    expect(clampMeshcoreLastAdvertSec(nowSec + 86_400, nowSec)).toBe(nowSec);
  });

  it('returns 0 for nullish input', () => {
    expect(clampMeshcoreLastAdvertSec(0, nowSec)).toBe(0);
    expect(clampMeshcoreLastAdvertSec(NaN, nowSec)).toBe(0);
  });
});
