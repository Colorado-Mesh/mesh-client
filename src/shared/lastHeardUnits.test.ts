import { describe, expect, it } from 'vitest';

import { LAST_HEARD_MS_THRESHOLD, normalizeLastHeardToUnixSec } from './lastHeardUnits';

describe('normalizeLastHeardToUnixSec', () => {
  it('converts epoch milliseconds to seconds', () => {
    expect(normalizeLastHeardToUnixSec(1_781_468_253_215)).toBe(1_781_468_253);
  });

  it('passes through epoch seconds unchanged', () => {
    expect(normalizeLastHeardToUnixSec(1_781_468_253)).toBe(1_781_468_253);
  });

  it('returns 0 for nullish and non-finite input', () => {
    expect(normalizeLastHeardToUnixSec(0)).toBe(0);
    expect(normalizeLastHeardToUnixSec(NaN)).toBe(0);
  });

  it('uses ms threshold consistent with renderer nodeStatus', () => {
    expect(LAST_HEARD_MS_THRESHOLD).toBe(1_000_000_000_000);
    expect(normalizeLastHeardToUnixSec(LAST_HEARD_MS_THRESHOLD)).toBe(1_000_000_000);
    expect(normalizeLastHeardToUnixSec(LAST_HEARD_MS_THRESHOLD - 1)).toBe(
      LAST_HEARD_MS_THRESHOLD - 1,
    );
  });
});
