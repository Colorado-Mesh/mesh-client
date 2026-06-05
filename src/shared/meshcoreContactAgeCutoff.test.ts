// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { meshcoreContactsAgeCutoffSec } from './meshcoreContactAgeCutoff';

describe('meshcoreContactsAgeCutoffSec', () => {
  const nowMs = 1_700_000_000_000; // fixed ms anchor

  it('returns epoch seconds minus whole days (not milliseconds)', () => {
    expect(meshcoreContactsAgeCutoffSec(30, nowMs)).toBe(Math.floor(nowMs / 1000) - 30 * 86400);
  });

  it('honors fractional day counts', () => {
    expect(meshcoreContactsAgeCutoffSec(1.5, nowMs)).toBe(
      Math.floor(nowMs / 1000) - Math.floor(1.5 * 86400),
    );
  });

  it('returns null for invalid day counts', () => {
    expect(meshcoreContactsAgeCutoffSec(0, nowMs)).toBeNull();
    expect(meshcoreContactsAgeCutoffSec(-1, nowMs)).toBeNull();
    expect(meshcoreContactsAgeCutoffSec(Number.NaN, nowMs)).toBeNull();
  });

  it('keeps recent last_advert rows when used as SQL cutoff', () => {
    const cutoff = meshcoreContactsAgeCutoffSec(30, nowMs);
    expect(cutoff).not.toBeNull();
    if (cutoff === null) return;
    const recentSec = Math.floor(nowMs / 1000) - 86400;
    const staleSec = cutoff - 1;
    expect(recentSec).toBeGreaterThanOrEqual(cutoff);
    expect(staleSec).toBeLessThan(cutoff);
  });
});
