import { describe, expect, it } from 'vitest';

import { isSafeChatUrl, parseChatMentionSegments } from './chatMentionSegments';

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

  describe('URL detection', () => {
    it('detects a standalone https URL', () => {
      expect(parseChatMentionSegments('https://example.com')).toEqual([
        { kind: 'url', url: 'https://example.com' },
      ]);
    });

    it('detects a standalone http URL', () => {
      expect(parseChatMentionSegments('http://example.com')).toEqual([
        { kind: 'url', url: 'http://example.com' },
      ]);
    });

    it('extracts URL surrounded by text', () => {
      expect(parseChatMentionSegments('check https://example.com out')).toEqual([
        { kind: 'text', text: 'check ' },
        { kind: 'url', url: 'https://example.com' },
        { kind: 'text', text: ' out' },
      ]);
    });

    it('strips trailing punctuation from URL', () => {
      expect(parseChatMentionSegments('see https://example.com.')).toEqual([
        { kind: 'text', text: 'see ' },
        { kind: 'url', url: 'https://example.com' },
        { kind: 'text', text: '.' },
      ]);
    });

    it('preserves URL query params and paths', () => {
      expect(parseChatMentionSegments('https://example.com/path?a=1&b=2')).toEqual([
        { kind: 'url', url: 'https://example.com/path?a=1&b=2' },
      ]);
    });

    it('handles URL adjacent to mention', () => {
      expect(parseChatMentionSegments('@[Bob] https://example.com')).toEqual([
        { kind: 'mention', label: 'Bob' },
        { kind: 'text', text: ' ' },
        { kind: 'url', url: 'https://example.com' },
      ]);
    });

    it('does not detect non-http protocols as URLs', () => {
      expect(parseChatMentionSegments('ftp://example.com')).toEqual([
        { kind: 'text', text: 'ftp://example.com' },
      ]);
    });
  });
});

describe('isSafeChatUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeChatUrl('https://example.com')).toBe(true);
    expect(isSafeChatUrl('http://example.com/path')).toBe(true);
  });

  it('rejects javascript and other schemes', () => {
    expect(isSafeChatUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeChatUrl('file:///etc/passwd')).toBe(false);
  });
});
