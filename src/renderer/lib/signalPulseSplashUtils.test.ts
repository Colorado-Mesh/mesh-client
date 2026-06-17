import { describe, expect, it } from 'vitest';

import {
  getSignalPulseTheme,
  INCLUSIVE_ONE_LINER_KEYS,
  pickInclusiveOneLinerKey,
} from './signalPulseSplashUtils';

describe('pickInclusiveOneLinerKey', () => {
  it('returns a key from the pool', () => {
    const a = pickInclusiveOneLinerKey(0);
    expect(INCLUSIVE_ONE_LINER_KEYS).toContain(a);
  });

  it('is stable for the same seed', () => {
    expect(pickInclusiveOneLinerKey(42)).toBe(pickInclusiveOneLinerKey(42));
  });

  it('wraps negative seeds', () => {
    const n = INCLUSIVE_ONE_LINER_KEYS.length;
    expect(pickInclusiveOneLinerKey(-1)).toBe(INCLUSIVE_ONE_LINER_KEYS[n - 1]);
  });
});

describe('getSignalPulseTheme', () => {
  it('uses cyan accents for MeshCore', () => {
    const t = getSignalPulseTheme('meshcore');
    expect(t.ringStroke).toContain('22d3ee');
    expect(t.trailStroke).toContain('211, 238');
  });

  it('uses green accents for Meshtastic', () => {
    const t = getSignalPulseTheme('meshtastic');
    expect(t.ringStroke.toLowerCase()).toBe('#00ff00');
  });
});
