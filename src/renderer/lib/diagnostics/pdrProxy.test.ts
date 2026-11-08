import { describe, expect, it } from 'vitest';

import {
  meshcorePathReliabilityProxy,
  meshtasticEchoLossProxy,
  PDR_PROXY_MIN_SAMPLES,
} from './pdrProxy';

describe('meshtasticEchoLossProxy', () => {
  it('returns null without stats', () => {
    expect(meshtasticEchoLossProxy(null)).toBeNull();
    expect(meshtasticEchoLossProxy({ total: 0, duplicates: 0 })).toBeNull();
  });

  it('withholds reliability below the sample floor', () => {
    const proxy = meshtasticEchoLossProxy({
      total: PDR_PROXY_MIN_SAMPLES - 1,
      duplicates: 2,
    });
    expect(proxy?.echoLossRate).toBeCloseTo(2 / 9);
    expect(proxy?.reliability).toBeNull();
  });

  it('reports reliability when samples are sufficient', () => {
    const proxy = meshtasticEchoLossProxy({ total: 20, duplicates: 5 });
    expect(proxy?.reliability).toBeCloseTo(0.75);
  });
});

describe('meshcorePathReliabilityProxy', () => {
  it('returns null with no attempts', () => {
    expect(meshcorePathReliabilityProxy({ successCount: 0, failureCount: 0 })).toBeNull();
  });

  it('applies Laplace smoothing', () => {
    const proxy = meshcorePathReliabilityProxy({ successCount: 8, failureCount: 2 });
    expect(proxy?.reliability).toBeCloseTo(9 / 12);
    expect(proxy?.attempts).toBe(10);
  });
});
