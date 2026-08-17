/**
 * Renderer PCM helpers for LXST voice (QualityHigh contract from lxst-core).
 * Sidecar owns Opus encode/decode; we pack/resample float PCM for `/voice/audio`.
 */

/** Profile::QualityHigh wire value */
export const LXST_QUALITY_HIGH_PROFILE = 0x50;
export const LXST_QUALITY_HIGH_CHANNELS = 1;
export const LXST_QUALITY_HIGH_SAMPLE_RATE_HZ = 48_000;
export const LXST_QUALITY_HIGH_FRAME_SAMPLES = 2_880;

/** Chunk size keeps String.fromCharCode under engine argument limits. */
const FROM_CHAR_CODE_CHUNK = 0x8000;

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += FROM_CHAR_CODE_CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + FROM_CHAR_CODE_CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return binary;
}

export function encodeF32LeBase64(samples: Float32Array | number[]): string {
  const bytes = new Uint8Array(samples.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    view.setFloat32(i * 4, samples[i] ?? 0, true);
  }
  return btoa(bytesToBinaryString(bytes));
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
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getFloat32(i * 4, true);
  }
  return out;
}

/**
 * Linear-resample mono (or mix-down) PCM to a fixed frame size / sample rate.
 * Returns null when input is empty.
 */
export function resampleMonoToFixedFrame(
  input: Float32Array,
  inputSampleRateHz: number,
  outSamples: number,
  outSampleRateHz: number,
  inputChannels = 1,
): Float32Array | null {
  if (input.length === 0 || inputSampleRateHz <= 0 || outSamples <= 0 || outSampleRateHz <= 0) {
    return null;
  }
  const channels = Math.max(1, Math.floor(inputChannels));
  const inputFrames = Math.floor(input.length / channels);
  if (inputFrames <= 0) return null;

  const mono = new Float32Array(inputFrames);
  for (let i = 0; i < inputFrames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      sum += input[i * channels + c] ?? 0;
    }
    mono[i] = sum / channels;
  }

  const out = new Float32Array(outSamples);
  const ratio = inputSampleRateHz / outSampleRateHz;
  for (let i = 0; i < outSamples; i += 1) {
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

/**
 * Linear-resample mono (or mix-down) PCM to QualityHigh frame size.
 * Returns null when input is empty.
 */
export function packQualityHighFrame(
  input: Float32Array,
  inputSampleRateHz: number,
  inputChannels = 1,
): Float32Array | null {
  return resampleMonoToFixedFrame(
    input,
    inputSampleRateHz,
    LXST_QUALITY_HIGH_FRAME_SAMPLES,
    LXST_QUALITY_HIGH_SAMPLE_RATE_HZ,
    inputChannels,
  );
}

/** Voice-memo capture: 24 kHz / 60 ms → 1440 samples (QualityMedium Opus). */
export const VOICE_MEMO_SAMPLE_RATE_HZ = 24_000;
export const VOICE_MEMO_FRAME_SAMPLES = 1_440;

export function packVoiceMemoFrame(
  input: Float32Array,
  inputSampleRateHz: number,
  inputChannels = 1,
): Float32Array | null {
  return resampleMonoToFixedFrame(
    input,
    inputSampleRateHz,
    VOICE_MEMO_FRAME_SAMPLES,
    VOICE_MEMO_SAMPLE_RATE_HZ,
    inputChannels,
  );
}

export type VoiceDialResolution =
  | { dialHash: string; source: 'identity' | 'candidate' | 'destination' }
  | { errorKey: 'reticulumVoice.errors.noIdentity' };

function asHash32(value: string | null | undefined): string | null {
  const h = value?.trim().toLowerCase() ?? '';
  return /^[0-9a-f]{32}$/.test(h) ? h : null;
}

/**
 * Resolve dial target for `/voice/call`:
 * 1) explicit identity_hash
 * 2) candidate identities (activity / Remote)
 * 3) LXMF destination hash (sidecar dest→identity cache)
 */
export function resolveVoiceDialIdentityHash(opts: {
  identityHash?: string | null;
  candidateIdentityHashes?: Iterable<string>;
  /** LXMF peer destination — last-resort dial target for sidecar resolve. */
  destinationHash?: string | null;
}): VoiceDialResolution {
  const direct = asHash32(opts.identityHash);
  if (direct) return { dialHash: direct, source: 'identity' };
  for (const c of opts.candidateIdentityHashes ?? []) {
    const h = asHash32(c);
    if (h) return { dialHash: h, source: 'candidate' };
  }
  const dest = asHash32(opts.destinationHash);
  if (dest) return { dialHash: dest, source: 'destination' };
  return { errorKey: 'reticulumVoice.errors.noIdentity' };
}
