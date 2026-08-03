/**
 * Renderer PCM helpers for LXST voice (QualityHigh contract from lxst-core).
 * Sidecar owns Opus encode/decode; we pack/resample float PCM for `/voice/audio`.
 */

/** Profile::QualityHigh wire value */
export const LXST_QUALITY_HIGH_PROFILE = 0x50;
export const LXST_QUALITY_HIGH_CHANNELS = 1;
export const LXST_QUALITY_HIGH_SAMPLE_RATE_HZ = 48_000;
export const LXST_QUALITY_HIGH_FRAME_SAMPLES = 2_880;

export function encodeF32LeBase64(samples: Float32Array | number[]): string {
  const bytes = new Uint8Array(samples.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    view.setFloat32(i * 4, samples[i] ?? 0, true);
  }
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCodePoint(b);
  }
  return btoa(binary);
}

export function decodeF32LeBase64(samplesB64: string): Float32Array {
  if (!samplesB64) return new Float32Array(0);
  let binary: string;
  try {
    binary = atob(samplesB64);
  } catch {
    // catch-no-log-ok malformed base64 from sidecar
    return new Float32Array(0);
  }
  if (binary.length % 4 !== 0) return new Float32Array(0);
  const out = new Float32Array(binary.length / 4);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getFloat32(i * 4, true);
  }
  return out;
}

/**
 * Linear-resample mono (or mix-down) PCM to QualityHigh frame size.
 * Returns null when input is empty.
 */
export function packQualityHighFrame(
  input: Float32Array,
  inputSampleRateHz: number,
  inputChannels = 1,
): Float32Array | null {
  if (input.length === 0 || inputSampleRateHz <= 0) return null;
  const channels = Math.max(1, Math.floor(inputChannels));
  const inputFrames = Math.floor(input.length / channels);
  if (inputFrames <= 0) return null;

  // Mix to mono
  const mono = new Float32Array(inputFrames);
  for (let i = 0; i < inputFrames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      sum += input[i * channels + c] ?? 0;
    }
    mono[i] = sum / channels;
  }

  const out = new Float32Array(LXST_QUALITY_HIGH_FRAME_SAMPLES);
  const ratio = inputSampleRateHz / LXST_QUALITY_HIGH_SAMPLE_RATE_HZ;
  for (let i = 0; i < LXST_QUALITY_HIGH_FRAME_SAMPLES; i += 1) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, mono.length - 1);
    const t = srcPos - i0;
    const s0 = mono[Math.min(i0, mono.length - 1)] ?? 0;
    const s1 = mono[i1] ?? s0;
    out[i] = s0 + (s1 - s0) * t;
  }
  return out;
}

/** Resolve identity hash for dial: prefer identity_hash, else first from candidates. */
export function resolveVoiceDialIdentityHash(opts: {
  identityHash?: string | null;
  candidateIdentityHashes?: Iterable<string>;
}): { identityHash: string } | { errorKey: 'reticulumVoice.errors.noIdentity' } {
  const direct = opts.identityHash?.trim().toLowerCase();
  if (direct && /^[0-9a-f]{32}$/.test(direct)) {
    return { identityHash: direct };
  }
  for (const c of opts.candidateIdentityHashes ?? []) {
    const h = c.trim().toLowerCase();
    if (/^[0-9a-f]{32}$/.test(h)) return { identityHash: h };
  }
  return { errorKey: 'reticulumVoice.errors.noIdentity' };
}
