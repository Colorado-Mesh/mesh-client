import { describe, expect, it } from 'vitest';

import {
  bodyMentionsRrcNick,
  classifyRrcNotificationType,
  isRrcRoomMuted,
  isRrcWhisperRoom,
  rrcMuteViewKey,
  stripRrcMsgTargetAt,
} from './rrcMention';

describe('stripRrcMsgTargetAt', () => {
  it('strips a single leading @', () => {
    expect(stripRrcMsgTargetAt('@nv0n')).toBe('nv0n');
    expect(stripRrcMsgTargetAt(' @Alice ')).toBe('Alice');
    expect(stripRrcMsgTargetAt('nv0n')).toBe('nv0n');
    expect(stripRrcMsgTargetAt('@')).toBe('@');
  });
});

describe('bodyMentionsRrcNick', () => {
  it('matches @nick case-insensitively', () => {
    expect(bodyMentionsRrcNick('hey @nv0n check this', 'nv0n')).toBe(true);
    expect(bodyMentionsRrcNick('@NV0N', 'nv0n')).toBe(true);
    expect(bodyMentionsRrcNick('ping @Nv0n!', 'nv0n')).toBe(true);
  });

  it('does not match substrings of other nicks', () => {
    expect(bodyMentionsRrcNick('hey @nv0nextra', 'nv0n')).toBe(false);
    expect(bodyMentionsRrcNick('email nv0n@example.com', 'nv0n')).toBe(false);
    expect(bodyMentionsRrcNick('no mention here', 'nv0n')).toBe(false);
  });

  it('requires a non-empty nick', () => {
    expect(bodyMentionsRrcNick('@anyone', '')).toBe(false);
    expect(bodyMentionsRrcNick('@anyone', '   ')).toBe(false);
  });
});

describe('isRrcWhisperRoom', () => {
  it('treats per-peer @hash DMs and legacy [whispers] as whisper rooms', () => {
    expect(isRrcWhisperRoom('[whispers]')).toBe(true);
    expect(isRrcWhisperRoom(`@${'aa'.repeat(16)}`)).toBe(true);
    expect(isRrcWhisperRoom('#lobby')).toBe(false);
    expect(isRrcWhisperRoom('[hub]')).toBe(false);
  });
});

describe('classifyRrcNotificationType', () => {
  it('classifies whispers and dst_hash as dm', () => {
    expect(
      classifyRrcNotificationType({ body: 'hi', room: '[whispers]', kind: 'notice' }, 'nv0n'),
    ).toBe('dm');
    expect(
      classifyRrcNotificationType(
        { body: 'hi', room: `@${'aa'.repeat(16)}`, kind: 'notice' },
        'nv0n',
      ),
    ).toBe('dm');
    expect(
      classifyRrcNotificationType(
        { body: 'hi', room: '#lobby', kind: 'notice', dst_hash: 'aa'.repeat(16) },
        'nv0n',
      ),
    ).toBe('dm');
  });

  it('classifies @nick mentions as dm and other room traffic as channel', () => {
    expect(
      classifyRrcNotificationType({ body: 'hi @nv0n', room: '#lobby', kind: 'msg' }, 'nv0n'),
    ).toBe('dm');
    expect(
      classifyRrcNotificationType({ body: 'hello all', room: '#lobby', kind: 'msg' }, 'nv0n'),
    ).toBe('channel');
  });

  it('skips system and error kinds', () => {
    expect(
      classifyRrcNotificationType({ body: '@nv0n', room: '#lobby', kind: 'system' }, 'nv0n'),
    ).toBeNull();
    expect(
      classifyRrcNotificationType({ body: 'fail', room: '#lobby', kind: 'error' }, 'nv0n'),
    ).toBeNull();
  });
});

describe('rrcMuteViewKey', () => {
  it('normalizes hub and preserves room spelling', () => {
    expect(rrcMuteViewKey('AABB', '#Lobby')).toBe('rrc:aabb:#Lobby');
  });
});

describe('isRrcRoomMuted', () => {
  it('soft-matches #lobby vs lobby mute keys', () => {
    const muted = new Set(['rrc:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:#lobby']);
    expect(isRrcRoomMuted('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'lobby', muted)).toBe(true);
    expect(isRrcRoomMuted('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '#general', muted)).toBe(false);
  });
});
