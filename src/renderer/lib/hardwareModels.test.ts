import { describe, expect, it } from 'vitest';

import { meshtasticHwModelDisplay, meshtasticHwModelName } from './hardwareModels';

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

  it('returns Unknown for IDs absent from the HardwareModel enum', () => {
    expect(meshtasticHwModelName(200)).toBe('Unknown (200)');
  });

  it('names models added upstream since the curated table was written', () => {
    expect(meshtasticHwModelName(127)).toBe('Heltec Mesh Node T096');
    expect(meshtasticHwModelName(146)).toBe('MeshPager X2');
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

describe('meshtasticHwModelDisplay', () => {
  it('returns null for empty input', () => {
    expect(meshtasticHwModelDisplay(null)).toBeNull();
    expect(meshtasticHwModelDisplay(undefined)).toBeNull();
    expect(meshtasticHwModelDisplay('')).toBeNull();
    expect(meshtasticHwModelDisplay('   ')).toBeNull();
  });

  it('maps digit-only strings like meshtasticHwModelName', () => {
    expect(meshtasticHwModelDisplay('43')).toBe('Heltec V3');
    expect(meshtasticHwModelDisplay('0')).toBe('Unset');
    expect(meshtasticHwModelDisplay(43)).toBe('Heltec V3');
  });

  it('passes through already-branded labels', () => {
    expect(meshtasticHwModelDisplay('Heltec V3')).toBe('Heltec V3');
    expect(meshtasticHwModelDisplay('Unset')).toBe('Unset');
  });

  it('passes through legacy non-numeric codes', () => {
    expect(meshtasticHwModelDisplay('TBEAM')).toBe('TBEAM');
  });

  it('passes through Unknown (n) from unmapped IDs', () => {
    expect(meshtasticHwModelDisplay('Unknown (200)')).toBe('Unknown (200)');
  });
});
