import { describe, expect, it } from 'vitest';

import {
  mergeMeshtasticTraceRouteIntoResultsMap,
  meshtasticTraceRouteLookupKeys,
} from './meshtasticTraceRouteLookupKeys';

describe('meshtasticTraceRouteLookupKeys', () => {
  it('includes mesh sender, every hop, and Data.dest', () => {
    const keys = meshtasticTraceRouteLookupKeys({
      from: 0x11111111,
      data: { route: [0x0aaaaaaa, 0xbbbbbbbb], routeBack: [] },
      dataLayerDest: 0xcccccccc,
    });
    expect(keys).toContain(0x11111111);
    expect(keys).toContain(0x0aaaaaaa);
    expect(keys).toContain(0xbbbbbbbb);
    expect(keys).toContain(0xcccccccc);
  });

  it('includes route_back hops', () => {
    const keys = meshtasticTraceRouteLookupKeys({
      from: 0x100,
      data: { route: [], routeBack: [0x200, 0x300] },
    });
    expect(keys).toContain(0x100);
    expect(keys).toContain(0x200);
    expect(keys).toContain(0x300);
  });

  it('ignores broadcast Data.dest', () => {
    const keys = meshtasticTraceRouteLookupKeys({
      from: 1,
      data: { route: [], routeBack: [] },
      dataLayerDest: 0xffffffff,
    });
    expect(keys).toEqual([1]);
  });
});

describe('mergeMeshtasticTraceRouteIntoResultsMap', () => {
  it('stores under lookup keys', () => {
    const prev = new Map<number, { route: number[]; from: number; timestamp: number }>();
    const next = mergeMeshtasticTraceRouteIntoResultsMap(
      prev,
      0x100,
      {
        route: [0x200],
        routeBack: [],
      },
      0x300,
    );
    expect(next.get(0x300)).toBeDefined();
    expect(next.get(0x200)).toBeDefined();
  });
});
