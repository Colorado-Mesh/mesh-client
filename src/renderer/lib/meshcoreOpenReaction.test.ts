import { describe, expect, it } from 'vitest';

import {
  buildMeshcoreOpenReactionIncomingMessage,
  buildMeshcoreOpenReactionWire,
  computeMeshcoreOpenReactionHash,
  dartStringHashCode,
  findMeshcoreOpenReactionParent,
  formatMeshcoreOpenReactionWire,
  isMeshcoreInteroperableReactionGlyph,
  MESHCORE_OPEN_REACTION_EMOJIS,
  meshcoreOpenEmojiToIndex,
  meshcoreOpenIndexToEmoji,
  parseMeshcoreOpenReactionWire,
} from './meshcoreOpenReaction';
import type { ChatMessage } from './types';

describe('dartStringHashCode', () => {
  it('matches Dart VM String.hashCode (verified against Dart 3.12)', () => {
    expect(dartStringHashCode('1234567890Alicehello')).toBe(402_086_443);
    expect(dartStringHashCode('1700000000Test')).toBe(476_109_731);
    expect(dartStringHashCode('1700000000Some Namehello')).toBe(663_767_062);
    expect(dartStringHashCode('1700000000hello')).toBe(159_187_775);
  });
});

describe('computeMeshcoreOpenReactionHash', () => {
  it('uses channel sender name and first five payload chars', () => {
    expect(computeMeshcoreOpenReactionHash(1_700_000_000, 'Target', 'parent text')).toBe('c360');
  });

  it('omits sender name for DM-style hash input', () => {
    expect(computeMeshcoreOpenReactionHash(1_700_000_000, null, 'parent text')).toBe('9cb2');
  });
});

describe('meshcoreOpenReaction wire codec', () => {
  it('recognizes interoperable glyphs from the Open table', () => {
    expect(isMeshcoreInteroperableReactionGlyph('👍')).toBe(true);
    expect(isMeshcoreInteroperableReactionGlyph('🍟')).toBe(false);
    expect(meshcoreOpenEmojiToIndex('🍟')).toBeNull();
  });

  it('round-trips emoji index 0 as thumbs up', () => {
    expect(meshcoreOpenEmojiToIndex('👍')).toBe('00');
    expect(meshcoreOpenIndexToEmoji('00')).toBe('👍');
    expect(parseMeshcoreOpenReactionWire('r:c360:00')).toEqual({
      targetHash: 'c360',
      emoji: '👍',
    });
  });

  it('formats lowercase wire text', () => {
    expect(formatMeshcoreOpenReactionWire('DBA3', '0A')).toBe('r:dba3:0a');
  });

  it('resolves 👎 after quick + smileys + duplicate 👍 in gestures table', () => {
    const idx = MESHCORE_OPEN_REACTION_EMOJIS.indexOf('👎');
    expect(idx).toBeGreaterThan(MESHCORE_OPEN_REACTION_EMOJIS.indexOf('👍'));
    expect(meshcoreOpenEmojiToIndex('👎')).toBe(idx.toString(16).padStart(2, '0'));
  });
});

describe('buildMeshcoreOpenReactionWire', () => {
  const parent: ChatMessage = {
    sender_id: 10,
    sender_name: 'Target',
    payload: 'parent text',
    channel: 0,
    timestamp: 1_700_000_000_000,
    status: 'acked',
    packetId: 99,
  };

  it('builds r: wire for channel reactions', () => {
    expect(buildMeshcoreOpenReactionWire(parent, '👍', { isDm: false })).toBe('r:c360:00');
  });

  it('builds r: wire for DM reactions without sender name in hash', () => {
    expect(buildMeshcoreOpenReactionWire(parent, '👍', { isDm: true })).toBe('r:9cb2:00');
  });

  it('returns null when emoji is outside the MeshCore Open table', () => {
    expect(buildMeshcoreOpenReactionWire(parent, '🍟', { isDm: false })).toBeNull();
  });
});

describe('findMeshcoreOpenReactionParent', () => {
  const baseTime = 1_700_000_000_000;

  it('returns newest channel message matching the hash', () => {
    const older: ChatMessage = {
      sender_id: 10,
      sender_name: 'Target',
      payload: 'other text',
      channel: 0,
      timestamp: baseTime,
      status: 'acked',
    };
    const parent: ChatMessage = {
      sender_id: 10,
      sender_name: 'Target',
      payload: 'parent text',
      channel: 0,
      timestamp: baseTime + 1000,
      status: 'acked',
      packetId: 99,
    };
    const hash = computeMeshcoreOpenReactionHash(
      Math.floor(parent.timestamp / 1000),
      'Target',
      'parent text',
    );
    const found = findMeshcoreOpenReactionParent([older, parent], hash, {
      channel: 0,
      beforeTimestamp: baseTime + 5000,
      isDm: false,
    });
    expect(found).toBe(parent);
  });

  it('returns undefined when no message matches the hash', () => {
    const parent: ChatMessage = {
      sender_id: 10,
      sender_name: 'Target',
      payload: 'parent text',
      channel: 0,
      timestamp: baseTime,
      status: 'acked',
    };
    expect(
      findMeshcoreOpenReactionParent([parent], 'ffff', {
        channel: 0,
        beforeTimestamp: baseTime + 5000,
        isDm: false,
      }),
    ).toBeUndefined();
  });

  it('skips existing tapback rows when resolving parent', () => {
    const parent: ChatMessage = {
      sender_id: 10,
      sender_name: 'Target',
      payload: 'parent text',
      channel: 0,
      timestamp: baseTime,
      status: 'acked',
      packetId: 99,
    };
    const priorTapback: ChatMessage = {
      sender_id: 20,
      sender_name: 'Someone',
      payload: '👍',
      channel: 0,
      timestamp: baseTime + 500,
      status: 'acked',
      emoji: 0x1f44d,
      replyId: 99,
    };
    const hash = computeMeshcoreOpenReactionHash(
      Math.floor(parent.timestamp / 1000),
      'Target',
      'parent text',
    );
    expect(
      findMeshcoreOpenReactionParent([parent, priorTapback], hash, {
        channel: 0,
        beforeTimestamp: baseTime + 5000,
        isDm: false,
      }),
    ).toBe(parent);
  });

  it('resolves DM parent without sender name in hash input', () => {
    const parent: ChatMessage = {
      sender_id: 60,
      sender_name: 'Bob',
      payload: 'ping',
      channel: -1,
      timestamp: baseTime,
      status: 'acked',
      to: 50,
    };
    const hash = computeMeshcoreOpenReactionHash(Math.floor(parent.timestamp / 1000), null, 'ping');
    const found = findMeshcoreOpenReactionParent([parent], hash, {
      channel: -1,
      beforeTimestamp: baseTime + 5000,
      isDm: true,
    });
    expect(found).toBe(parent);
  });
});

describe('buildMeshcoreOpenReactionIncomingMessage', () => {
  const baseTime = 1_700_000_000_000;

  it('links replyId and preview when parent is found', () => {
    const parent: ChatMessage = {
      sender_id: 10,
      sender_name: 'Target',
      payload: 'parent text',
      channel: 0,
      timestamp: baseTime,
      status: 'acked',
      packetId: 99,
    };
    const hash = computeMeshcoreOpenReactionHash(
      Math.floor(baseTime / 1000),
      'Target',
      'parent text',
    );
    const msg = buildMeshcoreOpenReactionIncomingMessage(
      [parent],
      {
        sender_id: 20,
        sender_name: 'Someone',
        channel: 0,
        timestamp: baseTime + 500,
        status: 'acked',
        receivedVia: 'rf',
        meshcoreDedupeKey: 'Someone: r:hash:00',
      },
      { targetHash: hash, emoji: '👍' },
      { channel: 0, beforeTimestamp: baseTime + 500, isDm: false },
    );
    expect(msg.replyId).toBe(99);
    expect(msg.replyPreviewText).toBe('parent text');
    expect(msg.replyPreviewSender).toBe('Target');
    expect(msg.payload).toBe('👍');
    expect(msg.emoji).toBe(0x1f44d);
  });

  it('omits replyId when parent hash does not match any message', () => {
    const msg = buildMeshcoreOpenReactionIncomingMessage(
      [],
      {
        sender_id: 20,
        sender_name: 'Someone',
        channel: 0,
        timestamp: baseTime + 500,
        status: 'acked',
        receivedVia: 'rf',
        meshcoreDedupeKey: 'Someone: r:ffff:00',
      },
      { targetHash: 'ffff', emoji: '👍' },
      { channel: 0, beforeTimestamp: baseTime + 500, isDm: false },
    );
    expect(msg.replyId).toBeUndefined();
    expect(msg.replyPreviewText).toBeUndefined();
    expect(msg.payload).toBe('👍');
  });
});
