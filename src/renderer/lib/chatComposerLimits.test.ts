import { describe, expect, it } from 'vitest';

import {
  countMessageChars,
  getChatPayloadLimit,
  MAX_CHUNKS,
  MESHCORE_PAYLOAD_LIMIT,
  MESHTASTIC_PAYLOAD_LIMIT,
  splitChatMessage,
} from './chatComposerLimits';

describe('getChatPayloadLimit', () => {
  it('returns 228 for meshtastic', () => {
    expect(getChatPayloadLimit('meshtastic')).toBe(MESHTASTIC_PAYLOAD_LIMIT);
  });

  it('returns 133 for meshcore', () => {
    expect(getChatPayloadLimit('meshcore')).toBe(MESHCORE_PAYLOAD_LIMIT);
  });
});

describe('countMessageChars', () => {
  it('counts ASCII correctly', () => {
    expect(countMessageChars('hello')).toBe(5);
  });

  it('counts emoji as one char each', () => {
    // 🦊 is a single code point, not two UTF-16 chars
    expect(countMessageChars('🦊')).toBe(1);
    expect(countMessageChars('hi🦊')).toBe(3);
  });

  it('returns 0 for empty string', () => {
    expect(countMessageChars('')).toBe(0);
  });
});

describe('splitChatMessage', () => {
  it('returns [] when text fits in one message (meshtastic)', () => {
    const text = 'a'.repeat(228);
    expect(splitChatMessage(text, 'meshtastic')).toEqual([]);
  });

  it('returns [] when text fits in one message (meshcore)', () => {
    const text = 'a'.repeat(133);
    expect(splitChatMessage(text, 'meshcore')).toEqual([]);
  });

  it('splits a message that exceeds the limit', () => {
    // Use meshcore limit (133) to make a short test case.
    // "[1/2] " prefix = 6 chars → body space = 127 chars.
    // 200 chars = must split into 2 chunks.
    const text = 'a'.repeat(200);
    const chunks = splitChatMessage(text, 'meshcore');
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBe(2);
    expect(chunks![0].startsWith('[1/2] ')).toBe(true);
    expect(chunks![1].startsWith('[2/2] ')).toBe(true);
    // All body chars should be present
    const bodies = chunks!.map((c) => c.replace(/^\[\d+\/\d+\] /, ''));
    expect(bodies.join('').length).toBe(200);
  });

  it('prefers word boundaries when splitting', () => {
    // Build a string with a space that lands near the boundary
    const limit = MESHCORE_PAYLOAD_LIMIT; // 133
    const prefixLen = '[1/2] '.length; // 6
    const bodySpace = limit - prefixLen; // 127
    const chunk1Words = 'word '.repeat(25); // 125 chars, ends with space
    const rest = 'overflow words here';
    const text = chunk1Words + rest;
    const chunks = splitChatMessage(text, 'meshcore');
    expect(chunks).not.toBeNull();
    // First chunk body should not start with a space
    const body0 = chunks![0].replace(/^\[\d+\/\d+\] /, '');
    expect(body0.endsWith(' ')).toBe(false);
    expect(body0.length).toBeLessThanOrEqual(bodySpace);
  });

  it('hard-splits a single long token with no spaces', () => {
    const longToken = 'x'.repeat(300);
    const chunks = splitChatMessage(longToken, 'meshtastic');
    expect(chunks).not.toBeNull();
    // Should produce multiple chunks
    expect(chunks!.length).toBeGreaterThan(1);
    // Every chunk body should fit in the limit
    for (const chunk of chunks!) {
      expect(countMessageChars(chunk)).toBeLessThanOrEqual(MESHTASTIC_PAYLOAD_LIMIT);
    }
  });

  it('returns null when text requires more than MAX_CHUNKS chunks', () => {
    // MAX_CHUNKS = 9 for meshcore (limit 133). "[9/9] " = 6 chars prefix → 127 body per chunk.
    // 127 * 9 + 1 = 1144 chars needed to overflow 9 chunks.
    const text = 'x'.repeat(9 * 127 + 1);
    expect(splitChatMessage(text, 'meshcore')).toBeNull();
  });

  it('returns exactly MAX_CHUNKS chunks at the boundary (not null)', () => {
    // 9 chunks of 127 chars each = 1143 chars max for meshcore
    const text = 'x'.repeat(9 * 127);
    const chunks = splitChatMessage(text, 'meshcore');
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBe(MAX_CHUNKS);
  });

  it('chunk bodies joined equal original trimmed text (no spaces in content)', () => {
    const text = 'x'.repeat(400);
    const chunks = splitChatMessage(text, 'meshtastic');
    expect(chunks).not.toBeNull();
    const bodies = chunks!.map((c) => c.replace(/^\[\d+\/\d+\] /, ''));
    expect(bodies.join('')).toBe(text);
  });

  it('trims whitespace from text before splitting', () => {
    const text = '  hello  ';
    expect(splitChatMessage(text, 'meshtastic')).toEqual([]);
  });
});
