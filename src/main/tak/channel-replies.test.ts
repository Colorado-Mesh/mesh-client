import { beforeEach, describe, expect, it } from 'vitest';

import { ChannelReplies, normalizeReplyName } from './channel-replies';

// Ported from ChannelRepliesTest in Colorado-Mesh/meshcore-kotlin, so both apps keep the same rules.
const NOW = 1_800_000_000_000;
const PUBLIC = '0123456789abcdef';
const OPS = 'fedcba9876543210';

describe('ChannelReplies', () => {
  let replies: ChannelReplies;
  beforeEach(() => {
    replies = new ChannelReplies();
    replies.heard(PUBLIC, 'Silver Eagle', NOW - 300_000);
    replies.heard(PUBLIC, 'SCRAM-A1 (FOEHAMMER)', NOW - 200_000);
    replies.heard(PUBLIC, 'M🐻β', NOW - 100_000);
    replies.heard(PUBLIC, '🔥 W0RMT 03', NOW - 50_000);
    replies.heard(OPS, 'Hobo', NOW - 10_000);
  });
  const send = (text: string, channel = PUBLIC) => replies.resolve(channel, text, NOW);
  const repliedTo = (text: string, channel = PUBLIC) => {
    const out = send(text, channel);
    return out.kind === 'send' ? out.repliedTo : undefined;
  };

  it('addresses a reply by the start of a name', () => {
    expect(send('@silver are you on the repeater?')).toEqual({
      kind: 'send',
      text: '@[Silver Eagle] are you on the repeater?',
      message: 'are you on the repeater?',
      repliedTo: 'Silver Eagle',
    });
  });

  it('ignores case, spaces, emoji and punctuation', () => {
    expect(repliedTo('@w0rmt hi')).toBe('🔥 W0RMT 03');
    expect(repliedTo('@W0RMT03, hi')).toBe('🔥 W0RMT 03');
    expect(repliedTo('@mβ ha')).toBe('M🐻β');
  });

  it('matches a quoted name with spaces', () => {
    expect(send('@"silver eagle" ok')).toMatchObject({ text: '@[Silver Eagle] ok' });
  });

  it('replies to whoever spoke last with @@', () => {
    expect(send('@@ thanks!')).toMatchObject({ text: '@[🔥 W0RMT 03] thanks!' });
    expect(send('@@ agreed', OPS)).toMatchObject({ text: '@[Hobo] agreed', repliedTo: 'Hobo' });
    expect(send('@@', OPS)).toMatchObject({ text: '@[Hobo]', message: '' });
  });

  it('sends nothing for @@ on a quiet channel', () => {
    expect(send('@@ anyone?', 'aaaaaaaaaaaaaaaa')).toEqual({ kind: 'nobody' });
  });

  it('sends nothing when several match, and says who, most recent first', () => {
    expect(send('@s hello')).toEqual({
      kind: 'ambiguous',
      typed: 's',
      names: ['SCRAM-A1 (FOEHAMMER)', 'Silver Eagle'],
    });
  });

  it('lets an exact match win over longer names', () => {
    const r = new ChannelReplies();
    r.heard(PUBLIC, 'Bob', NOW - 20_000);
    r.heard(PUBLIC, 'Bobcat', NOW - 10_000);
    expect(r.resolve(PUBLIC, '@bob yes', NOW)).toMatchObject({ text: '@[Bob] yes' });
    expect(r.resolve(PUBLIC, '@bo yes', NOW)).toEqual({
      kind: 'ambiguous',
      typed: 'bo',
      names: ['Bobcat', 'Bob'],
    });
  });

  it('sends the text as typed when nobody matches', () => {
    expect(send('@home in 10')).toEqual({ kind: 'send', text: '@home in 10' });
    expect(send('@ 5pm then')).toEqual({ kind: 'send', text: '@ 5pm then' });
    expect(send('@"unclosed quote')).toEqual({ kind: 'send', text: '@"unclosed quote' });
  });

  it('leaves ordinary and already formatted text alone', () => {
    expect(send('good morning')).toEqual({ kind: 'send', text: 'good morning' });
    expect(send('@[Silver Eagle] hi')).toEqual({ kind: 'send', text: '@[Silver Eagle] hi' });
  });

  it('keeps names per channel', () => {
    expect(send('@hobo hi', PUBLIC)).toEqual({ kind: 'send', text: '@hobo hi' });
    expect(repliedTo('@hobo hi', OPS)).toBe('Hobo');
  });

  it('forgets names heard too long ago', () => {
    const r = new ChannelReplies(50, 3_600_000);
    r.heard(PUBLIC, 'Old Timer', NOW - 7_200_000);
    expect(r.resolve(PUBLIC, '@old hi', NOW)).toEqual({ kind: 'send', text: '@old hi' });
    expect(r.resolve(PUBLIC, '@@ hi', NOW)).toEqual({ kind: 'nobody' });
  });

  it('keeps only the most recent names', () => {
    const r = new ChannelReplies(2);
    r.heard(PUBLIC, 'A1', NOW - 30_000);
    r.heard(PUBLIC, 'B2', NOW - 20_000);
    r.heard(PUBLIC, 'C3', NOW - 10_000);
    expect(r.recent(PUBLIC, NOW)).toEqual(['C3', 'B2']);
  });

  it('makes someone heard again the last speaker', () => {
    replies.heard(PUBLIC, 'Silver Eagle', NOW - 1_000);
    expect(repliedTo('@@ welcome back')).toBe('Silver Eagle');
  });

  it('ignores an empty or overlong name', () => {
    const r = new ChannelReplies();
    r.heard(PUBLIC, '  ', NOW);
    r.heard(PUBLIC, 'x'.repeat(60), NOW);
    expect(r.recent(PUBLIC, NOW)).toEqual([]);
  });

  it('forgets everyone on clear', () => {
    replies.clear();
    expect(send('@@ hi')).toEqual({ kind: 'nobody' });
  });

  it('normalizes names to letters and digits', () => {
    expect(normalizeReplyName('🔥 W0RMT 03')).toBe('w0rmt03');
    expect(normalizeReplyName('M🐻β')).toBe('mβ');
  });
});
