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

  it('parses Ratspeak one-space /list NOTICE', () => {
    const body = [
      'Registered public rooms:',
      ' catfacts - Cat Facts! Type !catfact for a fact about cats!',
      ' chat-hispano',
      ' general',
      ' linux',
      ' n2ycr - sunday 16:00 EDT weekly net - ham radio club',
    ].join('\n');
    expect(parseRrcListNotice(body)).toEqual([
      { name: 'catfacts', topic: 'Cat Facts! Type !catfact for a fact about cats!' },
      { name: 'chat-hispano' },
      { name: 'general' },
      { name: 'linux' },
      { name: 'n2ycr', topic: 'sunday 16:00 EDT weekly net - ham radio club' },
    ]);
  });

  it('ignores Ratspeak (+N more) omission footer', () => {
    const body = ['Registered public rooms:', ' alpha - First', ' bravo', ' (+17 more)'].join('\n');
    expect(parseRrcListNotice(body)).toEqual([
      { name: 'alpha', topic: 'First' },
      { name: 'bravo' },
    ]);
  });

  it('returns empty list when hub reports none', () => {
    expect(parseRrcListNotice('No public rooms registered')).toEqual([]);
  });

  it('returns empty list for header with no room rows', () => {
    expect(parseRrcListNotice('Registered public rooms:')).toEqual([]);
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

  it('classifies /who lines and rejects join-info and /list', () => {
    expect(parseRrcWhoNotice('members in general: Alice (aabbccddeeff)')).not.toBeNull();
    expect(parseRrcWhoNotice('members in general: (none)')).not.toBeNull();
    expect(
      parseRrcWhoNotice('room general: registered; mode=+r; topic=General chat - Colorado Mesh'),
    ).toBeNull();
    expect(
      parseRrcWhoNotice('Registered public rooms:\n  general - General chat - Colorado Mesh'),
    ).toBeNull();
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
