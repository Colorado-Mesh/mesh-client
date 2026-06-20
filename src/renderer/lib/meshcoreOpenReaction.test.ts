import { describe, expect, it } from 'vitest';

import {
  buildMeshcoreOpenReactionWire,
  computeMeshcoreOpenReactionHash,
  dartStringHashCode,
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
