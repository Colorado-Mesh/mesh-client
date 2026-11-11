import { describe, expect, it } from 'vitest';

import {
  meshcoreTraceSimChain,
  simulateMeshcoreTrace,
} from './meshcoreTraceFirmwareSimTestHelpers';

function key(...lead: number[]): Uint8Array {
  const k = new Uint8Array(32).fill(0xee);
  k.set(lead, 0);
  return k;
}

const RELAY = { name: 'relay', pubKey: key(0x57, 0xaa, 0x11) };
const FAR_RELAY = { name: 'farRelay', pubKey: key(0x21, 0xbb, 0x12) };
const DEST = { name: 'dest', pubKey: key(0x07, 0xcc, 0x13) };

describe('simulateMeshcoreTrace', () => {
  it('returns a zero-hop trace of one destination entry', () => {
    const mesh = meshcoreTraceSimChain([], DEST);
    const result = simulateMeshcoreTrace(mesh, new Uint8Array([0x07]), 0);
    expect(result.returned).toBe(true);
    expect(result.forwardedBy).toEqual(['dest']);
    expect(result.snrCount).toBe(1);
  });

  it('never returns a one-way path to a repeater one hop away', () => {
    const mesh = meshcoreTraceSimChain([RELAY], DEST);
    const result = simulateMeshcoreTrace(mesh, new Uint8Array([0x57, 0x07]), 0);
    expect(result.forwardedBy).toEqual(['relay', 'dest']);
    expect(result.returned).toBe(false);
  });

  it('returns a path that loops back through the relay', () => {
    const mesh = meshcoreTraceSimChain([RELAY], DEST);
    const result = simulateMeshcoreTrace(mesh, new Uint8Array([0x57, 0x07, 0x57]), 0);
    expect(result.returned).toBe(true);
    expect(result.forwardedBy).toEqual(['relay', 'dest', 'relay']);
    expect(result.snrCount).toBe(3);
  });

  it('reads two 1-byte hashes sent with flags 1 as one 2-byte entry that nobody matches', () => {
    const mesh = meshcoreTraceSimChain([RELAY], DEST);
    const result = simulateMeshcoreTrace(mesh, new Uint8Array([0x57, 0x07]), 1);
    expect(result.forwardedBy).toEqual([]);
    expect(result.returned).toBe(false);
  });

  it('returns a two-relay round trip of 2-byte entries', () => {
    const mesh = meshcoreTraceSimChain([RELAY, FAR_RELAY], DEST);
    const path = new Uint8Array([0x57, 0xaa, 0x21, 0xbb, 0x07, 0xcc, 0x21, 0xbb, 0x57, 0xaa]);
    const result = simulateMeshcoreTrace(mesh, path, 1);
    expect(result.returned).toBe(true);
    expect(result.forwardedBy).toEqual(['relay', 'farRelay', 'dest', 'farRelay', 'relay']);
  });

  it('rejects a path that is not a whole number of entries', () => {
    const mesh = meshcoreTraceSimChain([RELAY], DEST);
    const result = simulateMeshcoreTrace(mesh, new Uint8Array([0x57, 0xaa, 0x07]), 1);
    expect(result.rejected).toBe(true);
    expect(result.returned).toBe(false);
  });
});
