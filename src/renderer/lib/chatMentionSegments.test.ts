import { describe, expect, it } from 'vitest';

import { parseChatMentionSegments } from './chatMentionSegments';

describe('parseChatMentionSegments', () => {
  it('returns empty array for empty input', () => {
    expect(parseChatMentionSegments('')).toEqual([]);
  });

  it('returns single text segment when no brackets', () => {
    expect(parseChatMentionSegments('hello')).toEqual([{ kind: 'text', text: 'hello' }]);
  });

  it('splits leading mention', () => {
    expect(parseChatMentionSegments('@[Bob] hi')).toEqual([
      { kind: 'mention', label: 'Bob' },
      { kind: 'text', text: ' hi' },
    ]);
  });

  it('trims label inside brackets', () => {
    expect(parseChatMentionSegments('@[  NVON 02  ] x')).toEqual([
      { kind: 'mention', label: 'NVON 02' },
      { kind: 'text', text: ' x' },
    ]);
  });

  it('handles emoji and unicode in label', () => {
    expect(parseChatMentionSegments('@[🅰️ Alex KØALB] path')).toEqual([
      { kind: 'mention', label: '🅰️ Alex KØALB' },
      { kind: 'text', text: ' path' },
    ]);
  });

  it('handles multiple mentions and inline mention', () => {
    expect(parseChatMentionSegments('a @[B] c @[D]e')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'mention', label: 'B' },
      { kind: 'text', text: ' c ' },
      { kind: 'mention', label: 'D' },
      { kind: 'text', text: 'e' },
    ]);
  });

  it('leaves unclosed bracket as plain text', () => {
    expect(parseChatMentionSegments('@[no close')).toEqual([{ kind: 'text', text: '@[no close' }]);
  });

  it('allows empty label', () => {
    expect(parseChatMentionSegments('@[] x')).toEqual([
      { kind: 'mention', label: '' },
      { kind: 'text', text: ' x' },
    ]);
  });
});
