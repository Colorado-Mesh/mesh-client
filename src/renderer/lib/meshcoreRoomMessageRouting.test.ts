import { describe, expect, it } from 'vitest';

import { MESHCORE_TXT_TYPE_PLAIN, MESHCORE_TXT_TYPE_SIGNED_PLAIN } from './meshcoreChannelText';
import {
  looksLikeRoomPlainSystemLine,
  looksLikeSignedPlainWirePrefix,
  meshcoreRoomPostBodyFromWire,
  shouldStripRoomPostAuthorPrefix,
} from './meshcoreRoomMessageRouting';

describe('shouldStripRoomPostAuthorPrefix', () => {
  it('strips when txtType is SignedPlain', () => {
    const wire = '\0\0\0\0Hello';
    expect(shouldStripRoomPostAuthorPrefix(wire, MESHCORE_TXT_TYPE_SIGNED_PLAIN)).toBe(true);
  });

  it('does not strip PLAIN system lines with readable ASCII prefix', () => {
    expect(shouldStripRoomPostAuthorPrefix('Bot Stats (24h):', MESHCORE_TXT_TYPE_PLAIN)).toBe(
      false,
    );
    expect(looksLikeRoomPlainSystemLine('Bot Stats (24h):')).toBe(true);
  });

  it('strips binary prefix from known room node when txtType is PLAIN', () => {
    const authorPrefix = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const wire = `${authorPrefix}Test from og app`;
    expect(looksLikeSignedPlainWirePrefix(wire)).toBe(true);
    expect(shouldStripRoomPostAuthorPrefix(wire, MESHCORE_TXT_TYPE_PLAIN, true)).toBe(true);
  });

  it('does not strip PLAIN body from unknown sender without room context', () => {
    const authorPrefix = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const wire = `${authorPrefix}Test from og app`;
    expect(shouldStripRoomPostAuthorPrefix(wire, MESHCORE_TXT_TYPE_PLAIN, false)).toBe(false);
  });
});

describe('meshcoreRoomPostBodyFromWire', () => {
  it('strips SignedPlain body when txtType is 0 but prefix is binary (official app path)', () => {
    const authorPubKey = new Uint8Array(32);
    authorPubKey.set([0x93, 0x6c, 0x73, 0x49], 0);
    const prefixHex = Array.from(authorPubKey.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const prefixMap = new Map<string, number>([[prefixHex, 0xdeadbeef]]);
    const authorPrefix = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const wire = `${authorPrefix}Test from og app`;

    const parsed = meshcoreRoomPostBodyFromWire(wire, MESHCORE_TXT_TYPE_PLAIN, prefixMap, {
      isKnownRoomNode: true,
    });
    expect(parsed.payload).toBe('Test from og app');
    expect(parsed.authorId).toBe(0xdeadbeef);
  });

  it('preserves Bot Stats system line on PLAIN txtType', () => {
    const body = 'Bot Stats (24h):';
    const parsed = meshcoreRoomPostBodyFromWire(body, MESHCORE_TXT_TYPE_PLAIN, new Map(), {
      isKnownRoomNode: true,
    });
    expect(parsed.payload).toBe(body);
    expect(parsed.authorId).toBe(0);
  });
});
