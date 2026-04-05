import { describe, expect, it } from 'vitest';

import { batteryGaugeFilledBars, batteryGaugeTier } from '@/renderer/lib/batteryGaugeUtils';

describe('batteryGaugeTier', () => {
  it('maps boundary tiers', () => {
    expect(batteryGaugeTier(0)).toBe('red');
    expect(batteryGaugeTier(10)).toBe('red');
    expect(batteryGaugeTier(11)).toBe('orange');
    expect(batteryGaugeTier(29)).toBe('orange');
    expect(batteryGaugeTier(30)).toBe('yellow');
    expect(batteryGaugeTier(49)).toBe('yellow');
    expect(batteryGaugeTier(50)).toBe('blue');
    expect(batteryGaugeTier(79)).toBe('blue');
    expect(batteryGaugeTier(80)).toBe('green');
    expect(batteryGaugeTier(100)).toBe('green');
  });

  it('clamps out-of-range values', () => {
    expect(batteryGaugeTier(-5)).toBe('red');
    expect(batteryGaugeTier(150)).toBe('green');
  });
});

describe('batteryGaugeFilledBars', () => {
  it('maps percent to 0–5 bars', () => {
    expect(batteryGaugeFilledBars(0)).toBe(0);
    expect(batteryGaugeFilledBars(1)).toBe(1);
    expect(batteryGaugeFilledBars(20)).toBe(1);
    expect(batteryGaugeFilledBars(21)).toBe(2);
    expect(batteryGaugeFilledBars(100)).toBe(5);
  });

  it('clamps out-of-range values', () => {
    expect(batteryGaugeFilledBars(-1)).toBe(0);
    expect(batteryGaugeFilledBars(200)).toBe(5);
  });
});
