import { describe, expect, it } from 'vitest';

import {
  meshcoreRoomStatusPingTraceResult,
  meshcoreShouldPingRoomViaStatus,
} from './meshcoreRoomStatusPing';

describe('meshcoreShouldPingRoomViaStatus', () => {
  it.each([
    ['Room', true],
    ['Repeater', false],
    ['Client', false],
    [undefined, false],
    [null, false],
  ] as const)('%s → %s', (hw, expected) => {
    expect(meshcoreShouldPingRoomViaStatus(hw)).toBe(expected);
  });
});

describe('meshcoreRoomStatusPingTraceResult', () => {
  const pubKey = Uint8Array.from([
    0xce, 0xd2, 0x7c, 0x1b, 0x13, 0xf8, 0x8d, 0x38, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
  ]);

  it('builds a zero-hop display row at the companion hash size', () => {
    expect(
      meshcoreRoomStatusPingTraceResult({
        destPubKey: pubKey,
        pathHashSizeBytes: 2,
        lastSnrDb: 6.5,
      }),
    ).toEqual({
      pathLen: 1,
      pathHashes: [0xce, 0xd2],
      hashSizeBytes: 2,
      pathSnrs: [6.5],
      lastSnr: 6.5,
      tag: 0,
    });
  });

  it('shortens 3-byte mode to a 2-byte TRACE entry size', () => {
    expect(
      meshcoreRoomStatusPingTraceResult({
        destPubKey: pubKey,
        pathHashSizeBytes: 3,
        lastSnrDb: 1,
      }).hashSizeBytes,
    ).toBe(2);
  });
});
