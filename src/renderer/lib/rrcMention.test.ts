import { describe, expect, it } from 'vitest';

import {
  bodyMentionsRrcNick,
  classifyRrcNotificationType,
  isRrcRoomMuted,
  isRrcWhisperRoom,
  resolveRrcAlertType,
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

describe('resolveRrcAlertType', () => {
  const dmHash = 'aa'.repeat(16);
  const whisper = { body: 'psst', room: '[whispers]', kind: 'notice' as const };
  const dstHash = { body: 'hi', room: '#lobby', kind: 'notice' as const, dst_hash: dmHash };
  const peerDm = { body: 'hi', room: `@${dmHash}`, kind: 'notice' as const };
  const mention = { body: 'hey @nv0n', room: '#lobby', kind: 'msg' as const };
  const mentionAction = { body: 'waves at @NV0N', room: '#lobby', kind: 'action' as const };
  const plain = { body: 'hello all', room: '#lobby', kind: 'msg' as const };
  const plainAction = { body: 'waves', room: '#lobby', kind: 'action' as const };
  const notice = { body: 'topic set', room: '#lobby', kind: 'notice' as const };
  const system = { body: '@nv0n', room: '#lobby', kind: 'system' as const };
  const error = { body: 'fail', room: '#lobby', kind: 'error' as const };

  it.each(['all', 'mentions'] as const)('classifies DMs as dm in %s mode', (notifyMode) => {
    expect(resolveRrcAlertType({ msg: whisper, nickname: 'nv0n', notifyMode, muted: false })).toBe(
      'dm',
    );
    expect(resolveRrcAlertType({ msg: dstHash, nickname: 'nv0n', notifyMode, muted: false })).toBe(
      'dm',
    );
    expect(resolveRrcAlertType({ msg: peerDm, nickname: 'nv0n', notifyMode, muted: false })).toBe(
      'dm',
    );
  });

  it.each(['all', 'mentions'] as const)('classifies @nick as dm in %s mode', (notifyMode) => {
    expect(resolveRrcAlertType({ msg: mention, nickname: 'nv0n', notifyMode, muted: false })).toBe(
      'dm',
    );
    expect(
      resolveRrcAlertType({ msg: mentionAction, nickname: 'nv0n', notifyMode, muted: false }),
    ).toBe('dm');
  });

  it('returns channel for plain room msg/action only in all mode', () => {
    expect(
      resolveRrcAlertType({ msg: plain, nickname: 'nv0n', notifyMode: 'all', muted: false }),
    ).toBe('channel');
    expect(
      resolveRrcAlertType({ msg: plainAction, nickname: 'nv0n', notifyMode: 'all', muted: false }),
    ).toBe('channel');
    expect(
      resolveRrcAlertType({ msg: plain, nickname: 'nv0n', notifyMode: 'mentions', muted: false }),
    ).toBeNull();
    expect(
      resolveRrcAlertType({
        msg: plainAction,
        nickname: 'nv0n',
        notifyMode: 'mentions',
        muted: false,
      }),
    ).toBeNull();
  });

  it.each(['all', 'mentions'] as const)('drops notice/system/error in %s mode', (notifyMode) => {
    expect(
      resolveRrcAlertType({ msg: notice, nickname: 'nv0n', notifyMode, muted: false }),
    ).toBeNull();
    expect(
      resolveRrcAlertType({ msg: system, nickname: 'nv0n', notifyMode, muted: false }),
    ).toBeNull();
    expect(
      resolveRrcAlertType({ msg: error, nickname: 'nv0n', notifyMode, muted: false }),
    ).toBeNull();
  });

  it('returns null when muted even for @nick in all mode', () => {
    expect(
      resolveRrcAlertType({ msg: mention, nickname: 'nv0n', notifyMode: 'all', muted: true }),
    ).toBeNull();
  });

  it('does not false-match mentions with empty nickname; DMs still alert', () => {
    expect(
      resolveRrcAlertType({ msg: mention, nickname: '', notifyMode: 'all', muted: false }),
    ).toBe('channel');
    expect(
      resolveRrcAlertType({ msg: mention, nickname: '   ', notifyMode: 'mentions', muted: false }),
    ).toBeNull();
    expect(
      resolveRrcAlertType({ msg: whisper, nickname: '', notifyMode: 'mentions', muted: false }),
    ).toBe('dm');
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
