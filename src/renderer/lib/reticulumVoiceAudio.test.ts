import { describe, expect, it } from 'vitest';

import {
  decodeF32LeBase64,
  encodeF32LeBase64,
  LXST_QUALITY_HIGH_FRAME_SAMPLES,
  packQualityHighFrame,
  resolveVoiceDialIdentityHash,
} from './reticulumVoiceAudio';

describe('reticulumVoiceAudio', () => {
  it('round-trips f32 le base64', () => {
    const src = new Float32Array([0, 0.5, -0.25]);
    const decoded = decodeF32LeBase64(encodeF32LeBase64(src));
    expect(decoded.length).toBe(3);
    expect(decoded[0]).toBeCloseTo(0);
    expect(decoded[1]).toBeCloseTo(0.5);
    expect(decoded[2]).toBeCloseTo(-0.25);
  });

  it('returns empty on short/invalid base64', () => {
    expect(decodeF32LeBase64('').length).toBe(0);
    expect(decodeF32LeBase64('@@@').length).toBe(0);
  });

  it('packs QualityHigh frame from 48k mono', () => {
    const input = new Float32Array(LXST_QUALITY_HIGH_FRAME_SAMPLES).fill(0.1);
    const packed = packQualityHighFrame(input, 48_000, 1);
    expect(packed).not.toBeNull();
    expect(packed!.length).toBe(LXST_QUALITY_HIGH_FRAME_SAMPLES);
  });

  it('returns null for empty input', () => {
    expect(packQualityHighFrame(new Float32Array(0), 48_000)).toBeNull();
  });

  it('resolves dial identity preferring identity_hash', () => {
    const id = 'a'.repeat(32);
    expect(
      resolveVoiceDialIdentityHash({
        identityHash: id,
        candidateIdentityHashes: ['b'.repeat(32)],
        destinationHash: 'c'.repeat(32),
      }),
    ).toEqual({ dialHash: id, source: 'identity' });
  });

  it('falls back to candidates then destination hash', () => {
    const id = 'c'.repeat(32);
    const dest = 'd'.repeat(32);
    expect(resolveVoiceDialIdentityHash({ candidateIdentityHashes: [id] })).toEqual({
      dialHash: id,
      source: 'candidate',
    });
    expect(resolveVoiceDialIdentityHash({ destinationHash: dest })).toEqual({
      dialHash: dest,
      source: 'destination',
    });
    expect(resolveVoiceDialIdentityHash({})).toEqual({
      errorKey: 'reticulumVoice.errors.noIdentity',
    });
  });
});
