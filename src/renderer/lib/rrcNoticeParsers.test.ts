import { describe, expect, it } from 'vitest';

import {
  isRrcJoinInfoNotice,
  isRrcModerationLanguage,
  parseRrcListNotice,
  parseRrcTopicNotice,
  parseRrcWhoNotice,
} from './rrcNoticeParsers';

describe('parseRrcListNotice', () => {
  it('parses rrcd registered public rooms NOTICE', () => {
    const body = [
      'Registered public rooms:',
      '  lobby - welcome to the lobby',
      '  general',
      '  #ops - operator lounge',
    ].join('\n');
    expect(parseRrcListNotice(body)).toEqual([
      { name: 'lobby', topic: 'welcome to the lobby' },
      { name: 'general' },
      { name: '#ops', topic: 'operator lounge' },
    ]);
  });

  it('returns empty list when hub reports none', () => {
    expect(parseRrcListNotice('No public rooms registered')).toEqual([]);
  });

  it('returns null for unrelated NOTICE text', () => {
    expect(parseRrcListNotice('hello from the hub')).toBeNull();
  });
});

describe('parseRrcWhoNotice', () => {
  it('parses nick and hash-prefix roster', () => {
    const parsed = parseRrcWhoNotice(
      'members in lobby: alice (aabbccddeeff), bob (112233445566), cdef0123456789ab',
    );
    expect(parsed?.room).toBe('lobby');
    expect(parsed?.members).toHaveLength(3);
    expect(parsed?.members[0]).toEqual({
      identity_hash: 'aabbccddeeff',
      nickname: 'alice',
    });
  });

  it('handles empty roster', () => {
    expect(parseRrcWhoNotice('members in #lobby: (none)')).toEqual({
      room: '#lobby',
      members: [],
    });
  });
});

describe('parseRrcTopicNotice', () => {
  it('parses join info and topic command replies', () => {
    expect(parseRrcTopicNotice('room lobby: registered; mode=+nrt; topic=hello world')).toEqual({
      room: 'lobby',
      topic: 'hello world',
    });
    expect(parseRrcTopicNotice('topic for #lobby: coffee chat')).toEqual({
      room: '#lobby',
      topic: 'coffee chat',
    });
    expect(parseRrcTopicNotice('topic for lobby is now: (cleared)')).toEqual({
      room: 'lobby',
      topic: '',
    });
  });
});

describe('isRrcJoinInfoNotice', () => {
  it('detects rrcd join-info NOTICE lines', () => {
    expect(isRrcJoinInfoNotice('room general: registered; mode=+nrt; topic=(none)')).toBe(true);
    expect(isRrcJoinInfoNotice('hello everyone')).toBe(false);
  });
});

describe('isRrcModerationLanguage', () => {
  it('detects ban/kick/key language', () => {
    expect(isRrcModerationLanguage('You were kicked from lobby')).toBe(true);
    expect(isRrcModerationLanguage('banned from this room')).toBe(true);
    expect(isRrcModerationLanguage('wrong room key')).toBe(true);
    expect(isRrcModerationLanguage('hello everyone')).toBe(false);
  });
});
