import { describe, expect, it } from 'vitest';

import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import {
  meshcoreContactHasLeftoverPathBytes,
  meshcoreContactOutPathBytesForTrace,
  meshcoreSnapshotContactPathFromContacts,
} from './meshcoreRadioContactPath';
import { pubkeyToNodeId } from './meshcoreUtils';

describe('meshcoreContactHasLeftoverPathBytes', () => {
  function buffer(bytes: number[]): Uint8Array {
    const outPath = new Uint8Array(64);
    outPath.set(bytes, 0);
    return outPath;
  }

  it.each([
    { name: 'direct, 1-byte length', outPathLen: 0x00, bytes: [0x57, 0x21] },
    { name: 'direct, 2-byte length', outPathLen: 0x40, bytes: [0x57, 0xa1] },
    { name: 'direct, 3-byte length read as int8', outPathLen: -128, bytes: [0x57] },
    { name: 'one 1-byte hop with a longer route behind it', outPathLen: 0x01, bytes: [0x57, 0xee] },
    { name: 'one 2-byte hop with a longer route behind it', outPathLen: 0x41, bytes: [1, 2, 3] },
    // The radio forgot the route (a reset leaves the bytes); it claims none of them.
    { name: 'no route (0xFF read as -1) over an older route', outPathLen: -1, bytes: [0x57, 0x21] },
    { name: 'no route (0xFF)', outPathLen: 0xff, bytes: [0x57] },
  ])('finds bytes past the route: $name', ({ outPathLen, bytes }) => {
    expect(meshcoreContactHasLeftoverPathBytes({ outPath: buffer(bytes), outPathLen })).toBe(true);
  });

  it.each([
    { name: 'direct with a clean buffer', outPathLen: 0x00, bytes: [] },
    { name: 'one 1-byte hop and nothing after it', outPathLen: 0x01, bytes: [0x57] },
    { name: 'two 2-byte hops and nothing after them', outPathLen: 0x42, bytes: [1, 2, 3, 4] },
    { name: 'no route (0xFF read as -1) and a clean buffer', outPathLen: -1, bytes: [] },
  ])('finds none: $name', ({ outPathLen, bytes }) => {
    expect(meshcoreContactHasLeftoverPathBytes({ outPath: buffer(bytes), outPathLen })).toBe(false);
  });

  it('is reported by the contact snapshot', () => {
    const publicKey = new Uint8Array(32).fill(0x07);
    const snap = meshcoreSnapshotContactPathFromContacts(pubkeyToNodeId(publicKey), [
      { publicKey, outPath: buffer([0x57, 0x21]), outPathLen: 0 } as MeshCoreContactRaw,
    ]);
    expect(snap.radioPathLeftover).toBe(true);
    expect(snap.radioContactPathLen).toBe(0);
  });
});

describe('meshcoreSnapshotContactPathFromContacts', () => {
  const pubKey = new Uint8Array(32);
  pubKey[0] = 0xab;
  pubKey[1] = 0xcd;
  const nodeId = pubkeyToNodeId(pubKey);

  it('returns radioContactFound false when contact list is empty', () => {
    expect(meshcoreSnapshotContactPathFromContacts(nodeId, [])).toEqual({
      path: undefined,
      radioContactPathLen: null,
      radioContactFound: false,
    });
  });

  it('slices outPath for a matching contact', () => {
    const snap = meshcoreSnapshotContactPathFromContacts(nodeId, [
      {
        publicKey: pubKey,
        type: 2,
        advName: 'RPT',
        lastAdvert: 1,
        advLat: 0,
        advLon: 0,
        flags: 0,
        outPathLen: 0,
        outPath: new Uint8Array([0xab, 0, 0]),
      },
    ]);
    expect(snap.radioContactFound).toBe(true);
    expect(snap.path).toEqual(new Uint8Array([0xab]));
  });

  it('ignores outPath buffer that is the full destination pubkey (not a hash route)', () => {
    const fullKey = Uint8Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);
    const remoteNodeId = pubkeyToNodeId(fullKey);
    const snap = meshcoreSnapshotContactPathFromContacts(remoteNodeId, [
      {
        publicKey: fullKey,
        type: 2,
        advName: 'RPT-1HOP',
        lastAdvert: 1,
        advLat: 0,
        advLon: 0,
        flags: 0,
        outPathLen: -1,
        outPath: new Uint8Array(fullKey),
      },
    ]);
    expect(snap.radioContactFound).toBe(true);
    expect(snap.radioContactPathLen).toBe(-1);
    expect(snap.path).toBeUndefined();
  });

  it('keeps valid 1-hop hash route from radio contact', () => {
    const snap = meshcoreSnapshotContactPathFromContacts(nodeId, [
      {
        publicKey: pubKey,
        type: 2,
        advName: 'RPT-1HOP',
        lastAdvert: 1,
        advLat: 0,
        advLon: 0,
        flags: 0,
        outPathLen: 1,
        outPath: new Uint8Array([0x11, 0x22, 0, 0]),
      },
    ]);
    expect(snap.path).toEqual(new Uint8Array([0x11, 0x22]));
  });
});

describe('meshcoreContactOutPathBytesForTrace', () => {
  const pubKey = new Uint8Array(32);
  pubKey[0] = 0xab;
  pubKey[1] = 0xcd;

  function contact(overrides: Partial<MeshCoreContactRaw> = {}): MeshCoreContactRaw {
    return {
      publicKey: pubKey,
      type: 2,
      advName: 'RPT',
      lastAdvert: 1,
      advLat: 0,
      advLon: 0,
      flags: 0,
      outPathLen: 1,
      outPath: new Uint8Array([0x11, 0x22, 0, 0]),
      ...overrides,
    };
  }

  it('slices multi-byte hash route from outPath', () => {
    expect(meshcoreContactOutPathBytesForTrace(contact())).toEqual(new Uint8Array([0x11, 0x22]));
  });

  it('uses fallback slice when outPathLen is 0', () => {
    expect(
      meshcoreContactOutPathBytesForTrace(
        contact({
          outPathLen: 0,
          outPath: new Uint8Array([0xab, 0, 0]),
        }),
      ),
    ).toEqual(new Uint8Array([0xab]));
  });

  it('falls back to dest prefix when outPath is full pubkey but radio reports multi-hop', () => {
    const fullKey = Uint8Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);
    expect(
      meshcoreContactOutPathBytesForTrace(
        contact({
          publicKey: fullKey,
          outPath: new Uint8Array(fullKey),
          outPathLen: 31,
        }),
      ),
    ).toEqual(new Uint8Array([fullKey[0]]));
  });

  it('returns empty bytes when outPath is the full destination pubkey without multi-hop len', () => {
    const fullKey = Uint8Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);
    expect(
      meshcoreContactOutPathBytesForTrace(
        contact({
          publicKey: fullKey,
          outPath: new Uint8Array(fullKey),
          outPathLen: -1,
        }),
      ),
    ).toEqual(new Uint8Array(0));
  });
});
