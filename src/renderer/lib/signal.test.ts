// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isWeakBleRssi, rssiToSignalLevel, weakestBleRssi } from './signal';

describe('rssiToSignalLevel', () => {
  it('maps boundaries used by BLE weak-signal UI', () => {
    expect(rssiToSignalLevel(null)).toBe(0);
    expect(rssiToSignalLevel(-79)).toBe(2);
    expect(rssiToSignalLevel(-80)).toBe(1);
    expect(rssiToSignalLevel(-90)).toBe(0);
    expect(rssiToSignalLevel(-95)).toBe(0);
  });
});

describe('isWeakBleRssi', () => {
  it('is false when RSSI is unknown', () => {
    expect(isWeakBleRssi(null)).toBe(false);
    expect(isWeakBleRssi(undefined)).toBe(false);
    expect(isWeakBleRssi(Number.NaN)).toBe(false);
  });

  it('is true at ≤ -80 dBm (level ≤ 1)', () => {
    expect(isWeakBleRssi(-79)).toBe(false);
    expect(isWeakBleRssi(-80)).toBe(true);
    expect(isWeakBleRssi(-95)).toBe(true);
  });
});

describe('weakestBleRssi', () => {
  it('returns the most negative finite RSSI', () => {
    expect(weakestBleRssi([{ rssi: -55 }, { rssi: -88 }, { rssi: null }])).toBe(-88);
    expect(weakestBleRssi([{ rssi: null }, {}])).toBeNull();
  });
});
