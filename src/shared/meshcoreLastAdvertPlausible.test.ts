import { describe, expect, it } from 'vitest';

import {
  isPlausibleMeshcoreLastAdvertSec,
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
