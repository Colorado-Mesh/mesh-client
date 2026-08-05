import { describe, expect, it } from 'vitest';

import type { MeshCoreSelfInfoWire } from '../meshcoreTelemetryPrivacy';
import {
  rememberMeshcoreDiscoverSelf,
  takeMeshcoreDiscoverSelfCache,
} from './meshcoreDiscoverSelfCache';

function wire(name: string): MeshCoreSelfInfoWire {
  return {
    name,
    publicKey: new Uint8Array(32).fill(1),
    type: 1,
    txPower: 22,
    advLat: 0,
    advLon: 0,
    radioFreq: 915_000_000,
  };
}

describe('meshcoreDiscoverSelfCache', () => {
  it('remembers and takes once per handle', () => {
    const handle = { id: 'tcp-conn' };
    rememberMeshcoreDiscoverSelf(handle, wire('a'));
    expect(takeMeshcoreDiscoverSelfCache(handle)?.name).toBe('a');
    expect(takeMeshcoreDiscoverSelfCache(handle)).toBeUndefined();
  });

  it('ignores non-object handles', () => {
    rememberMeshcoreDiscoverSelf(null, wire('x'));
    expect(takeMeshcoreDiscoverSelfCache(null)).toBeUndefined();
  });
});
