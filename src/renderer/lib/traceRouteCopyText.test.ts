import { describe, expect, it } from 'vitest';

import { formatMeshcoreTraceRoute, formatTraceRouteHops } from './traceRouteCopyText';

const ARROW = String.fromCodePoint(0x2192);

describe('formatTraceRouteHops', () => {
  it('joins hops in order on one line, the way the route path shows them', () => {
    expect(formatTraceRouteHops(['Base', 'Ridge Relay', '!a1b2c3d4'])).toBe(
      `Base ${ARROW} Ridge Relay ${ARROW} !a1b2c3d4`,
    );
  });

  it('returns a lone hop unchanged and nothing for an empty route', () => {
    expect(formatTraceRouteHops(['Base'])).toBe('Base');
    expect(formatTraceRouteHops([])).toBe('');
  });
});

describe('formatMeshcoreTraceRoute', () => {
  it('names each hop with its hash and SNR, then the destination', () => {
    expect(
      formatMeshcoreTraceRoute({
        hops: [
          { label: 'Ridge Relay', hex: 'c3', snr: 5.25 },
          { label: 'Mesa', hex: '7f', snr: -2 },
        ],
        destLabel: 'Trailhead',
        lastSnr: 3,
      }),
    ).toBe(`Ridge Relay [c3] +5.25 dB ${ARROW} Mesa [7f] -2.00 dB ${ARROW} Trailhead +3.00 dB`);
  });

  it('uses the hash alone when no contact name resolved', () => {
    expect(
      formatMeshcoreTraceRoute({
        hops: [{ label: 'c3', hex: 'c3', snr: 0 }],
        destLabel: 'Trailhead',
        lastSnr: 1.5,
      }),
    ).toBe(`c3 0.00 dB ${ARROW} Trailhead +1.50 dB`);
  });

  it('falls back to the numbered hop label when a hop has neither name nor hash', () => {
    expect(
      formatMeshcoreTraceRoute({
        hops: [{ label: '', hex: '', snr: 4 }],
        destLabel: 'Trailhead',
        lastSnr: 1,
        hopFallbackLabel: (n) => `Hop ${n}`,
      }),
    ).toBe(`Hop 1 +4.00 dB ${ARROW} Trailhead +1.00 dB`);
  });

  it('gives just the destination for a direct (zero-hop) trace', () => {
    expect(
      formatMeshcoreTraceRoute({
        hops: [],
        destLabel: 'Trailhead',
        lastSnr: 6,
      }),
    ).toBe('Trailhead +6.00 dB');
  });
});
