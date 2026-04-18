import { describe, expect, it } from 'vitest';

import { meshtasticHwModelName } from './hardwareModels';

describe('meshtasticHwModelName', () => {
  it('maps known values by number', () => {
    expect(meshtasticHwModelName(0)).toBe('Unset');
    expect(meshtasticHwModelName(4)).toBe('T-Beam');
    expect(meshtasticHwModelName(43)).toBe('Heltec V3');
    expect(meshtasticHwModelName(71)).toBe('Tracker T1000-E');
    expect(meshtasticHwModelName(126)).toBe('T-Display S3 Pro');
    expect(meshtasticHwModelName(255)).toBe('Private HW');
  });

  it('maps known values by string (as stored in DB)', () => {
    expect(meshtasticHwModelName('4')).toBe('T-Beam');
    expect(meshtasticHwModelName('43')).toBe('Heltec V3');
    expect(meshtasticHwModelName('255')).toBe('Private HW');
  });

  it('returns Unknown for unmapped numeric IDs', () => {
    expect(meshtasticHwModelName(200)).toBe('Unknown (200)');
    expect(meshtasticHwModelName(127)).toBe('Unknown (127)');
  });

  it('returns Unknown for unmapped string IDs', () => {
    expect(meshtasticHwModelName('200')).toBe('Unknown (200)');
  });

  it('returns Unknown for non-numeric strings', () => {
    expect(meshtasticHwModelName('bogus')).toBe('Unknown (bogus)');
  });

  it('covers all values 0–126 without gaps (spot-check boundaries)', () => {
    // All values in 0-126 and 255 should return a non-"Unknown" string
    const knownValues = [...Array.from({ length: 127 }, (_, i) => i), 255];
    for (const v of knownValues) {
      expect(meshtasticHwModelName(v)).not.toMatch(/^Unknown/);
    }
  });
});
