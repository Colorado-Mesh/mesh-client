import { describe, expect, it } from 'vitest';

import { MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG } from '../../shared/reactionEmoji';
import {
  firstGraphemeCluster,
  normalizeReactionEmoji,
  reactionDisplayGlyph,
  reactionGlyphFromPicker,
} from './reactions';

const US_FLAG = '\u{1F1FA}\u{1F1F8}';

describe('normalizeReactionEmoji', () => {
  it('treats wire 1 as Meshtastic tapback boolean and takes first scalar from payload even when <= 0x1000', () => {
    const digitKeycap = '3\uFE0F\u20E3';
    expect(normalizeReactionEmoji(MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG, digitKeycap)).toBe(
      digitKeycap.codePointAt(0),
    );
    expect(normalizeReactionEmoji(1, 'A')).toBe(65);
  });

  it('still maps wire 1 with empty payload to reaction index 1 (thumbs)', () => {
    const out = normalizeReactionEmoji(1, '   ');
    expect(out).toBe(128077);
  });

  it('maps wire indices 2..12 without payload to Unicode set', () => {
    expect(normalizeReactionEmoji(2, '')).toBe(10084);
    expect(normalizeReactionEmoji(12, '')).toBe(129300);
  });

  it('prefers payload high-plane codepoint when wire is not boolean 1', () => {
    expect(normalizeReactionEmoji(3, '👍')).toBe(0x1f44d);
  });

  it('stores first scalar of US flag from wire boolean 1 + payload', () => {
    expect(normalizeReactionEmoji(MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG, US_FLAG)).toBe(0x1f1fa);
  });
});

describe('firstGraphemeCluster', () => {
  it('returns one grapheme for US flag', () => {
    expect(firstGraphemeCluster(US_FLAG)).toBe(US_FLAG);
  });

  it('returns undefined for multi-grapheme text', () => {
    expect(firstGraphemeCluster('👍 hi')).toBeUndefined();
  });
});

describe('reactionDisplayGlyph', () => {
  it('renders US flag from payload when stored scalar is first regional indicator only', () => {
    expect(reactionDisplayGlyph(0x1f1fa, US_FLAG)).toBe(US_FLAG);
    expect(reactionDisplayGlyph(0x1f1fa, US_FLAG)).not.toBe('\u{1F1FA}');
  });

  it('falls back to scalar when payload is empty', () => {
    expect(reactionDisplayGlyph(0x1f44d, '')).toBe('👍');
  });
});

describe('reactionGlyphFromPicker', () => {
  it('returns full flag glyph and first scalar for storage', () => {
    const parsed = reactionGlyphFromPicker(US_FLAG);
    expect(parsed).toEqual({ glyph: US_FLAG, scalar: 0x1f1fa });
  });
});
