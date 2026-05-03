import { describe, expect, it } from 'vitest';

import {
  easeReadoutWipe,
  getSignalPulseTheme,
  horizontalReadoutFade,
  INCLUSIVE_ONE_LINERS,
  pickInclusiveOneLiner,
  smoothstepEdge,
} from './SignalPropagation';

describe('pickInclusiveOneLiner', () => {
  it('returns a phrase from the pool', () => {
    const a = pickInclusiveOneLiner(0);
    expect(INCLUSIVE_ONE_LINERS).toContain(a);
  });

  it('is stable for the same seed', () => {
    expect(pickInclusiveOneLiner(42)).toBe(pickInclusiveOneLiner(42));
  });

  it('wraps negative seeds', () => {
    const n = INCLUSIVE_ONE_LINERS.length;
    expect(pickInclusiveOneLiner(-1)).toBe(INCLUSIVE_ONE_LINERS[n - 1]);
  });
});

describe('smoothstepEdge', () => {
  it('is 0 below lo and 1 above hi', () => {
    expect(smoothstepEdge(10, 20, 5)).toBe(0);
    expect(smoothstepEdge(10, 20, 25)).toBe(1);
    expect(smoothstepEdge(10, 20, 15)).toBeGreaterThan(0);
    expect(smoothstepEdge(10, 20, 15)).toBeLessThan(1);
  });
});

describe('easeReadoutWipe', () => {
  it('is identity at endpoints', () => {
    expect(easeReadoutWipe(0)).toBe(0);
    expect(easeReadoutWipe(1)).toBe(1);
  });

  it('lags behind linear mid-way (ease-in; slower wipe)', () => {
    expect(easeReadoutWipe(0.5)).toBeLessThan(0.5);
  });
});

describe('horizontalReadoutFade', () => {
  const soft = 64;
  const textLeft = 400;
  const fullW = 220;

  it('keeps the phrase bright before the wipe progresses', () => {
    const leftGlyph = textLeft + 10;
    const rightGlyph = textLeft + fullW - 10;
    expect(horizontalReadoutFade(leftGlyph, textLeft, fullW, 0, soft)).toBeGreaterThan(0.9);
    expect(horizontalReadoutFade(rightGlyph, textLeft, fullW, 0, soft)).toBeGreaterThan(0.9);
  });

  it('dims left before right as wipe completes', () => {
    const leftGlyph = textLeft + 10;
    const rightGlyph = textLeft + fullW - 10;
    const lo = horizontalReadoutFade(leftGlyph, textLeft, fullW, 1, soft);
    const hi = horizontalReadoutFade(rightGlyph, textLeft, fullW, 1, soft);
    expect(lo).toBeLessThan(0.15);
    expect(hi).toBeLessThan(0.15);
  });

  it('at mid wipe, left is dimmer than right', () => {
    const leftGlyph = textLeft + 10;
    const rightGlyph = textLeft + fullW - 10;
    const aL = horizontalReadoutFade(leftGlyph, textLeft, fullW, 0.45, soft);
    const aR = horizontalReadoutFade(rightGlyph, textLeft, fullW, 0.45, soft);
    expect(aL).toBeLessThan(aR);
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
