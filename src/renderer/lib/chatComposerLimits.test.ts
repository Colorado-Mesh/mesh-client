import { describe, expect, it } from 'vitest';

import {
  computeComposerLimitStatus,
  computeComposerTotalMaxChars,
  countMessageChars,
  getChatPayloadLimit,
  getComposerWireOverhead,
  getMeshcoreChannelPayloadLimit,
  getMeshcoreRoomPayloadLimit,
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
});

describe('getMeshcoreRoomPayloadLimit', () => {
  it('returns 156 (160 minus 4-byte pubkey prefix)', () => {
    expect(getMeshcoreRoomPayloadLimit()).toBe(156);
  });
});

describe('getComposerWireOverhead', () => {
  it('returns 0 for meshtastic replies', () => {
    expect(getComposerWireOverhead({ protocol: 'meshtastic', replyToSenderName: 'Bob' })).toBe(0);
  });

  it('counts MeshCore reply prefix on first chunk', () => {
    expect(getComposerWireOverhead({ protocol: 'meshcore', replyToSenderName: 'Bob' })).toBe(7);
  });

  it('counts keyed MeshCore reply prefix when replyKey is set', () => {
    expect(
      getComposerWireOverhead({
        protocol: 'meshcore',
        replyToSenderName: 'Bob',
        replyKey: 1_780_235_760_847,
      }),
    ).toBe(countMessageChars('@[Bob#1780235760847] '));
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
