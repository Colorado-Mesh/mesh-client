import { describe, expect, it } from 'vitest';

import { meshcoreSnapshotContactPathFromContacts } from './meshcoreRadioContactPath';
import { pubkeyToNodeId } from './meshcoreUtils';

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
