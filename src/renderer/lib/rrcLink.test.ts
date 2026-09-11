import { describe, expect, it } from 'vitest';

import { isRrcLink, parseRrcLinkUrl } from './rrcLink';

const HASH = 'abcdef0123456789abcdef0123456789';

describe('parseRrcLinkUrl', () => {
  it('parses rrc:// hub only', () => {
    expect(parseRrcLinkUrl(`rrc://${HASH}`)).toEqual({
      hubHash: HASH,
      destName: null,
      room: null,
    });
  });

  it('parses dest name and room', () => {
    expect(parseRrcLinkUrl(`rrc://${HASH}:hub.session/#Lobby`)).toEqual({
      hubHash: HASH,
      destName: 'hub.session',
      room: 'lobby',
    });
  });

  it('parses room without dest name', () => {
    expect(parseRrcLinkUrl(`rrc://${HASH}/general`)).toEqual({
      hubHash: HASH,
      destName: null,
      room: 'general',
    });
  });

  it('expands rrc@ and rrc.hub.session@ shorthands', () => {
    expect(parseRrcLinkUrl(`rrc@${HASH}/ops`)).toEqual({
      hubHash: HASH,
      destName: null,
      room: 'ops',
    });
    expect(parseRrcLinkUrl(`rrc.hub.session@${HASH}`)?.hubHash).toBe(HASH);
  });

  it('unwraps nomadnetwork://rrc@ shorthand', () => {
    expect(parseRrcLinkUrl(`nomadnetwork://rrc@${HASH}/chat`)).toEqual({
      hubHash: HASH,
      destName: null,
      room: 'chat',
    });
  });

  it('rejects invalid hashes and non-RRC urls', () => {
    expect(parseRrcLinkUrl('rrc://deadbeef')).toBeNull();
    expect(parseRrcLinkUrl(`rrc://${HASH}zz`)).toBeNull();
    expect(parseRrcLinkUrl(`rrc://${HASH.slice(0, 31)}g`)).toBeNull();
    expect(parseRrcLinkUrl(`lxmf://${HASH}`)).toBeNull();
    expect(parseRrcLinkUrl('https://example.com')).toBeNull();
    expect(isRrcLink(`rrc://${HASH}`)).toBe(true);
    expect(isRrcLink(`lxmf://${HASH}`)).toBe(false);
  });
});
