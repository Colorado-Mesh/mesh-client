import { describe, expect, it } from 'vitest';

import { MESHCORE_TXT_TYPE_PLAIN } from './meshcoreChannelText';
import { buildSendTxtMsgFrame, meshcoreRoomPostWireBytes } from './meshcoreRoomPostRpc';

describe('meshcoreRoomPostRpc', () => {
  it('builds wire bytes with 4-byte author prefix + UTF-8 body', () => {
    const pubKey = new Uint8Array(32);
    pubKey.set([0x01, 0x02, 0x03, 0x04], 0);
    const wire = meshcoreRoomPostWireBytes(pubKey, 'Hi');
    expect(wire.length).toBe(6);
    expect(wire[0]).toBe(0x01);
    expect(new TextDecoder().decode(wire.subarray(4))).toBe('Hi');
  });

  it('buildSendTxtMsgFrame matches meshcore.js layout', () => {
    const roomKey = new Uint8Array(32);
    roomKey.fill(0xaa);
    const text = new TextEncoder().encode('body');
    const frame = buildSendTxtMsgFrame(MESHCORE_TXT_TYPE_PLAIN, 0, 1000, roomKey, text);
    expect(frame[0]).toBe(2);
    expect(frame[1]).toBe(MESHCORE_TXT_TYPE_PLAIN);
    expect(frame[2]).toBe(0);
    expect(frame[3]).toBe(0xe8);
    expect(frame[4]).toBe(0x03);
    expect(frame[5]).toBe(0);
    expect(frame[6]).toBe(0);
    expect(frame.subarray(7, 13)).toEqual(roomKey.subarray(0, 6));
    expect(Array.from(frame.subarray(13))).toEqual(Array.from(text));
  });
});
