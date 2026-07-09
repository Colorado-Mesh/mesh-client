import { describe, expect, it } from 'vitest';

import type { RxPacketEntry } from './meshcore/meshcoreHookTypes';
import { sortMeshcorePackets } from './rawPacketLogSort';

function entry(ts: number, hopCount: number): RxPacketEntry {
  return {
    ts,
    snr: 0,
    rssi: 0,
    raw: new Uint8Array([ts & 0xff]),
    routeTypeString: 'FLOOD',
    payloadTypeString: 'ADVERT',
    hopCount,
    pathBytes: [],
    pathHashSizeBytes: 1,
    fromNodeId: null,
    messageFingerprintHex: null,
    transportScopeCode: null,
    transportReturnCode: null,
    advertName: null,
    advertLat: null,
    advertLon: null,
    advertTimestampSec: null,
    parseOk: true,
  };
}

describe('rawPacketLogSort', () => {
  it('sorts MeshCore packets by hop count descending', () => {
    const sorted = sortMeshcorePackets([entry(1, 1), entry(2, 3), entry(3, 2)], {
      column: 'hops',
      direction: 'desc',
    });
    expect(sorted.map((p) => p.hopCount)).toEqual([3, 2, 1]);
  });
});
