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
  it('does not treat emoji tapback bodies as SignedPlain binary prefixes', () => {
    const tapback = '@[🛜 NV0N 01] 👋';
    expect(looksLikeSignedPlainWirePrefix(tapback)).toBe(false);
    expect(shouldStripRoomPostAuthorPrefix(tapback, MESHCORE_TXT_TYPE_PLAIN, true)).toBe(false);
    const parsed = meshcoreRoomPostBodyFromWire(tapback, MESHCORE_TXT_TYPE_PLAIN, new Map(), {
      isKnownRoomNode: true,
    });
    expect(parsed.payload).toBe(tapback);
    expect(parsed.authorId).toBe(0);
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

  it.each([
    ['an accented first letter', String.fromCodePoint(0xc9) + 'quipe ready'],
    ['Cyrillic', String.fromCodePoint(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442) + ' all'],
    ['a short first line', 'Hi' + String.fromCharCode(10) + 'there all'],
  ])('keeps a PLAIN line from a known room that starts with %s whole', (_label, wire) => {
    expect(looksLikeSignedPlainWirePrefix(wire)).toBe(false);
    const parsed = meshcoreRoomPostBodyFromWire(wire, MESHCORE_TXT_TYPE_PLAIN, new Map(), {
      isKnownRoomNode: true,
    });
    expect(parsed.payload).toBe(wire);
  });

  it('still strips 4 characters from a SignedPlain post whose body starts with an accented letter', () => {
    const body = String.fromCodePoint(0xc9) + 'quipe ready';
    const wire = String.fromCharCode(0x41, 0x42, 0xc9, 0x44) + body;
    const parsed = meshcoreRoomPostBodyFromWire(wire, MESHCORE_TXT_TYPE_SIGNED_PLAIN, new Map());
    expect(parsed.payload).toBe(body);
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
