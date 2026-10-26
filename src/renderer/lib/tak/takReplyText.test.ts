import { describe, expect, it } from 'vitest';

import { formatTakReplyText, TAK_REPLY_QUOTE_MAX } from './takReplyText';

describe('formatTakReplyText', () => {
  it('passes a plain message on as it is', () => {
    expect(formatTakReplyText('on scene', undefined)).toBe('on scene');
  });

  it('says whom a reply answers', () => {
    expect(formatTakReplyText('copy that', { reaction: false, to: ' Alice ' })).toBe(
      '@Alice copy that',
    );
  });

  it('says what a reaction reacts to, quoting it', () => {
    expect(
      formatTakReplyText('👍', { reaction: true, to: 'Alice', quote: 'meet at\nthe trailhead' }),
    ).toBe('👍 to Alice: "meet at the trailhead"');
    expect(formatTakReplyText('👍', { reaction: true, to: 'Alice' })).toBe('👍 to Alice');
  });

  it('cuts a long quote with an ellipsis, without splitting an emoji', () => {
    const quote = '😀'.repeat(TAK_REPLY_QUOTE_MAX + 5);
    const out = formatTakReplyText('👍', { reaction: true, to: 'Alice', quote });
    expect(out).toBe(`👍 to Alice: "${'😀'.repeat(TAK_REPLY_QUOTE_MAX - 1)}…"`);
  });

  it('passes a reply on as it is when its target is not known', () => {
    expect(formatTakReplyText('👍', { reaction: true, to: '  ' })).toBe('👍');
    expect(formatTakReplyText('copy', { reaction: false })).toBe('copy');
  });
});
