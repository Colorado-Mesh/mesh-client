import { describe, expect, it } from 'vitest';

import {
  computeComposerLimitStatus,
  computeComposerTotalMaxChars,
  countMessageChars,
  countMessageWireBytes,
  getChatPayloadLimit,
  getComposerWireOverhead,
  getMeshcoreChannelPayloadLimit,
  getMeshcoreRoomPayloadLimit,
  MAX_CHUNKS,
  MESHCORE_PAYLOAD_LIMIT,
  MESHTASTIC_PAYLOAD_LIMIT,
  MESHTASTIC_REPLY_ID_WIRE_BYTES,
  RETICULUM_LXMF_PAYLOAD_LIMIT,
  splitChatMessage,
} from './chatComposerLimits';

describe('getChatPayloadLimit', () => {
  it('returns 228 for meshtastic', () => {
    expect(getChatPayloadLimit('meshtastic')).toBe(MESHTASTIC_PAYLOAD_LIMIT);
  });

  it('returns 133 for meshcore', () => {
    expect(getChatPayloadLimit('meshcore')).toBe(MESHCORE_PAYLOAD_LIMIT);
  });

  it('returns LXMF limit for reticulum', () => {
    expect(getChatPayloadLimit('reticulum')).toBe(RETICULUM_LXMF_PAYLOAD_LIMIT);
  });
});

describe('getMeshcoreChannelPayloadLimit', () => {
  it('returns 157 for a 1-character display name', () => {
    expect(getMeshcoreChannelPayloadLimit('A')).toBe(157);
  });

  it('returns 126 for a 32-character display name', () => {
    expect(getMeshcoreChannelPayloadLimit('x'.repeat(32))).toBe(126);
  });

  it('caps name length at 32 characters', () => {
    expect(getMeshcoreChannelPayloadLimit('x'.repeat(40))).toBe(126);
  });

  it('reserves UTF-8 wire bytes for multi-byte display names', () => {
    // Cyrillic 'п' is 2 UTF-8 bytes; 10 codepoints → 20 wire bytes + ": " (2) → body 138.
    expect(getMeshcoreChannelPayloadLimit('п'.repeat(10))).toBe(160 - 20 - 2);
  });
});

describe('getMeshcoreRoomPayloadLimit', () => {
  it('returns 156 (160 minus 4-byte pubkey prefix)', () => {
    expect(getMeshcoreRoomPayloadLimit()).toBe(156);
  });
});

describe('getComposerWireOverhead', () => {
  it('returns 0 for meshtastic when no reply is pending', () => {
    expect(getComposerWireOverhead({ protocol: 'meshtastic', replyToSenderName: 'Bob' })).toBe(0);
  });

  it('reserves 5 wire bytes for meshtastic replies (fixed32 reply_id field)', () => {
    expect(
      getComposerWireOverhead({
        protocol: 'meshtastic',
        replyToSenderName: 'Bob',
        replyKey: 2_113_407_456,
      }),
    ).toBe(MESHTASTIC_REPLY_ID_WIRE_BYTES);
  });

  it('returns 0 for meshtastic when replyKey is 0', () => {
    expect(
      getComposerWireOverhead({ protocol: 'meshtastic', replyToSenderName: 'Bob', replyKey: 0 }),
    ).toBe(0);
  });

  it('counts MeshCore reply prefix on first chunk', () => {
    expect(getComposerWireOverhead({ protocol: 'meshcore', replyToSenderName: 'Bob' })).toBe(7);
  });

  it('counts keyless MeshCore reply prefix by default when replyKey is set', () => {
    expect(
      getComposerWireOverhead({
        protocol: 'meshcore',
        replyToSenderName: 'Bob',
        replyKey: 1_780_235_760_847,
      }),
    ).toBe(countMessageChars('@[Bob] '));
  });

  it('counts keyed MeshCore reply prefix when useKeyedReplies is true', () => {
    expect(
      getComposerWireOverhead({
        protocol: 'meshcore',
        replyToSenderName: 'Bob',
        replyKey: 1_780_235_760_847,
        useKeyedReplies: true,
      }),
    ).toBe(countMessageChars('@[Bob#1780235760847] '));
  });

  it('reserves the "Unknown" fallback length for an all-emoji sender name (keyless)', () => {
    // Regression: sanitizeMeshcoreWireName strips an all-pictographic name to '', and the real
    // wire builder falls back to the literal "Unknown" — a naive estimate from the raw name
    // ("@[😀] ", 5 chars) under-reserves by 6 bytes versus the true "@[Unknown] " (11 bytes).
    expect(getComposerWireOverhead({ protocol: 'meshcore', replyToSenderName: '😀' })).toBe(
      countMessageWireBytes('@[Unknown] '),
    );
  });

  it('reserves the "Unknown" fallback length for an all-emoji sender name (keyed)', () => {
    expect(
      getComposerWireOverhead({
        protocol: 'meshcore',
        replyToSenderName: '🔥🔥',
        replyKey: 1_780_235_760_847,
        useKeyedReplies: true,
      }),
    ).toBe(countMessageWireBytes('@[Unknown#1780235760847] '));
  });
});

describe('countMessageWireBytes', () => {
  it('matches countMessageChars for ASCII text', () => {
    expect(countMessageWireBytes('hello')).toBe(countMessageChars('hello'));
  });

  it('counts multi-byte UTF-8 characters by their real byte cost, not codepoint count', () => {
    // Cyrillic characters are 2 bytes each in UTF-8, but 1 codepoint each.
    const text = 'привет';
    expect(countMessageChars(text)).toBe(6);
    expect(countMessageWireBytes(text)).toBe(12);
  });

  it('counts an emoji as 4 bytes despite being 1 codepoint', () => {
    expect(countMessageChars('🦊')).toBe(1);
    expect(countMessageWireBytes('🦊')).toBe(4);
  });
});

describe('countMessageChars', () => {
  it('counts ASCII correctly', () => {
    expect(countMessageChars('hello')).toBe(5);
  });

  it('counts emoji as one char each', () => {
    expect(countMessageChars('🦊')).toBe(1);
    expect(countMessageChars('hi🦊')).toBe(3);
  });

  it('returns 0 for empty string', () => {
    expect(countMessageChars('')).toBe(0);
  });
});

describe('computeComposerLimitStatus', () => {
  it('returns ok phase below 80% threshold', () => {
    const status = computeComposerLimitStatus('hello', 'meshtastic');
    expect(status.phase).toBe('ok');
    expect(status.charCount).toBe(5);
  });

  it('returns warn phase at 80%+ for meshtastic', () => {
    const text = 'a'.repeat(183);
    const status = computeComposerLimitStatus(text, 'meshtastic');
    expect(status.phase).toBe('warn');
    expect(status.showThreshold).toBe(182);
  });

  it('returns split phase when text exceeds single-message limit', () => {
    const text = 'a'.repeat(250);
    const status = computeComposerLimitStatus(text, 'meshtastic');
    expect(status.phase).toBe('split');
    expect(status.chunkCount).toBeGreaterThan(1);
  });

  it('uses dynamic meshcore channel limit from display name', () => {
    const text = 'a'.repeat(130);
    const shortName = computeComposerLimitStatus(text, 'meshcore', {
      composerContext: 'channel',
      senderDisplayName: 'A',
    });
    expect(shortName.singleMessageLimit).toBe(157);
    expect(shortName.phase).toBe('warn');

    const longName = computeComposerLimitStatus(text, 'meshcore', {
      composerContext: 'channel',
      senderDisplayName: 'x'.repeat(32),
    });
    expect(longName.singleMessageLimit).toBe(126);
    expect(longName.phase).toBe('split');
  });

  it('returns overMax when text exceeds total max chars', () => {
    const limit = MESHTASTIC_PAYLOAD_LIMIT;
    const totalMax = computeComposerTotalMaxChars(limit);
    const text = 'x'.repeat(totalMax + 1);
    const status = computeComposerLimitStatus(text, 'meshtastic');
    expect(status.phase).toBe('overMax');
    expect(status.chunkCount).toBe(0);
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
    const text = 'a'.repeat(200);
    const chunks = splitChatMessage(text, 'meshcore');
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBe(2);
    expect(chunks![0].startsWith('[1/2] ')).toBe(true);
    expect(chunks![1].startsWith('[2/2] ')).toBe(true);
    const bodies = chunks!.map((c) => c.replace(/^\[\d+\/\d+\] /, ''));
    expect(bodies.join('').length).toBe(200);
  });

  it('prefers word boundaries when splitting', () => {
    const limit = MESHCORE_PAYLOAD_LIMIT;
    const prefixLen = '[1/2] '.length;
    const bodySpace = limit - prefixLen;
    const chunk1Words = 'word '.repeat(25);
    const rest = 'overflow words here';
    const text = chunk1Words + rest;
    const chunks = splitChatMessage(text, 'meshcore');
    expect(chunks).not.toBeNull();
    const body0 = chunks![0].replace(/^\[\d+\/\d+\] /, '');
    expect(body0.endsWith(' ')).toBe(false);
    expect(body0.length).toBeLessThanOrEqual(bodySpace);
  });

  it('hard-splits a single long token with no spaces', () => {
    const longToken = 'x'.repeat(300);
    const chunks = splitChatMessage(longToken, 'meshtastic');
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBeGreaterThan(1);
    for (const chunk of chunks!) {
      expect(countMessageChars(chunk)).toBeLessThanOrEqual(MESHTASTIC_PAYLOAD_LIMIT);
    }
  });

  it('accounts for reply wire overhead on first chunk only', () => {
    const limit = 133;
    const overhead = getComposerWireOverhead({ protocol: 'meshcore', replyToSenderName: 'Bob' });
    const fitsWithout = 'a'.repeat(limit);
    expect(splitChatMessage(fitsWithout, 'meshcore', limit, 0)).toEqual([]);
    expect(splitChatMessage(fitsWithout, 'meshcore', limit, overhead)).not.toEqual([]);
  });

  it('splits a max-length meshtastic reply instead of overflowing the radio payload', () => {
    // Regression: a 228-char reply previously fit in one chunk (overhead was ignored),
    // silently overflowing the true wire payload once the 5-byte fixed32 reply_id field
    // was added by the SDK/radio, which the firmware NAKed as TOO_LARGE.
    const text = 'a'.repeat(MESHTASTIC_PAYLOAD_LIMIT);
    const overhead = getComposerWireOverhead({ protocol: 'meshtastic', replyKey: 2_113_407_456 });
    expect(overhead).toBe(MESHTASTIC_REPLY_ID_WIRE_BYTES);
    expect(splitChatMessage(text, 'meshtastic', MESHTASTIC_PAYLOAD_LIMIT, 0)).toEqual([]);
    const chunks = splitChatMessage(text, 'meshtastic', MESHTASTIC_PAYLOAD_LIMIT, overhead);
    expect(chunks).not.toEqual([]);
    expect(chunks).not.toBeNull();
  });

  it('splits multi-byte text that fits the codepoint limit but not the real byte limit', () => {
    // Regression: Cyrillic 'п' is 1 codepoint but 2 UTF-8 bytes. 200 codepoints is under the
    // 228-codepoint limit (previously judged "fits in one message"), but 400 real wire bytes —
    // nearly double the true 228-byte Meshtastic payload — which the radio would NAK as TOO_LARGE.
    const text = 'п'.repeat(200);
    expect(countMessageChars(text)).toBeLessThanOrEqual(MESHTASTIC_PAYLOAD_LIMIT);
    expect(countMessageWireBytes(text)).toBeGreaterThan(MESHTASTIC_PAYLOAD_LIMIT);
    const chunks = splitChatMessage(text, 'meshtastic');
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBeGreaterThan(1);
    for (const chunk of chunks!) {
      expect(countMessageWireBytes(chunk)).toBeLessThanOrEqual(MESHTASTIC_PAYLOAD_LIMIT);
    }
    const bodies = chunks!.map((c) => c.replace(/^\[\d+\/\d+\] /, ''));
    expect(bodies.join('')).toBe(text);
  });

  it('returns null when text requires more than MAX_CHUNKS chunks', () => {
    const text = 'x'.repeat(9 * 127 + 1);
    expect(splitChatMessage(text, 'meshcore')).toBeNull();
  });

  it('returns exactly MAX_CHUNKS chunks at the boundary (not null)', () => {
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
