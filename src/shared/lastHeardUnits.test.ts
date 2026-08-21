import { describe, expect, it } from 'vitest';

import {
  LAST_HEARD_MS_THRESHOLD,
  NODES_LAST_HEARD_SEC_SQL,
  normalizeLastHeardToUnixSec,
} from './lastHeardUnits';

/** Evaluate {@link NODES_LAST_HEARD_SEC_SQL} CASE branches in JS (same thresholds/divisors). */
function evalNodesLastHeardSecSql(lastHeard: number): number {
  if (lastHeard >= 1_000_000_000_000_000_000) return Math.trunc(lastHeard / 1_000_000_000);
  if (lastHeard >= 1_000_000_000_000_000) return Math.trunc(lastHeard / 1_000_000);
  if (lastHeard >= 1_000_000_000_000) return Math.trunc(lastHeard / 1_000);
  return lastHeard;
}

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

  it('collapses Date×1000 overshoot (~1e15) to unix seconds', () => {
    // Field afternoon shape: Protocol did Date×1000 → ~1e15 before a single export /1000.
    expect(normalizeLastHeardToUnixSec(1_787_340_581_000_000)).toBe(1_787_340_581);
  });

  it('collapses single-scale epoch ms (~1e12) to unix seconds', () => {
    expect(normalizeLastHeardToUnixSec(1_787_340_581_000)).toBe(1_787_340_581);
  });

  it('collapses triple-scale overshoot (~1e18) to unix seconds', () => {
    expect(normalizeLastHeardToUnixSec(1_787_340_581_000_000_000)).toBe(1_787_340_581);
  });
});

describe('NODES_LAST_HEARD_SEC_SQL', () => {
  it('encodes three-pass thresholds matching normalizeLastHeardToUnixSec', () => {
    expect(NODES_LAST_HEARD_SEC_SQL).toContain('1000000000000000000');
    expect(NODES_LAST_HEARD_SEC_SQL).toContain('/ 1000000000');
    expect(NODES_LAST_HEARD_SEC_SQL).toContain('1000000000000000');
    expect(NODES_LAST_HEARD_SEC_SQL).toContain('/ 1000000');
    expect(NODES_LAST_HEARD_SEC_SQL).toContain('1000000000000');
    expect(NODES_LAST_HEARD_SEC_SQL).toContain('/ 1000');
  });

  it.each([
    [1_787_340_581, 1_787_340_581],
    [1_787_340_581_000, 1_787_340_581],
    [1_787_340_581_000_000, 1_787_340_581],
    [1_787_340_581_000_000_000, 1_787_340_581],
  ] as const)('CASE(%s) → %s aligned with normalize', (input, expectedSec) => {
    expect(evalNodesLastHeardSecSql(input)).toBe(expectedSec);
    expect(normalizeLastHeardToUnixSec(input)).toBe(expectedSec);
  });
});
