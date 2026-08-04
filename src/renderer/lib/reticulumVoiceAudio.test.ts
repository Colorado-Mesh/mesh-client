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

  it('resamples non-48kHz mono into QualityHigh frame size', () => {
    const input = new Float32Array(1_440).fill(0.2); // 30 ms @ 48 kHz-equivalent length @ 24 kHz
    const packed = packQualityHighFrame(input, 24_000, 1);
    expect(packed).not.toBeNull();
    expect(packed!.length).toBe(LXST_QUALITY_HIGH_FRAME_SAMPLES);
    expect(packed![0]).toBeCloseTo(0.2, 5);
  });

  it('mixes multichannel input down to mono before packing', () => {
    const frames = 1_000;
    const stereo = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i += 1) {
      stereo[i * 2] = 0.5;
      stereo[i * 2 + 1] = -0.5;
    }
    const packed = packQualityHighFrame(stereo, 48_000, 2);
    expect(packed).not.toBeNull();
    expect(packed!.length).toBe(LXST_QUALITY_HIGH_FRAME_SAMPLES);
    expect(packed![0]).toBeCloseTo(0, 5);
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

  it('normalizes uppercase identity hashes and rejects invalid lengths', () => {
    const upper = 'A'.repeat(32);
    expect(
      resolveVoiceDialIdentityHash({
        identityHash: upper,
      }),
    ).toEqual({ dialHash: 'a'.repeat(32), source: 'identity' });
    expect(
      resolveVoiceDialIdentityHash({
        identityHash: 'abc',
        destinationHash: 'not-32-chars',
      }),
    ).toEqual({ errorKey: 'reticulumVoice.errors.noIdentity' });
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
