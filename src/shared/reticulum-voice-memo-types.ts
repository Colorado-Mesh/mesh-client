/** Shared LXMF voice memo types (sidecar HTTP ↔ renderer). */

/** AM_OPUS_OGG mode value (FIELD_AUDIO mode 0x10). */
export const LXMF_AUDIO_MODE_OPUS_OGG = 16;

/** Sidecar/LXMF error when packed size exceeds PN deposit (Direct-only delivery). */
export const RETICULUM_MESSAGE_TOO_LARGE_FOR_PROPAGATION = 'message_too_large_for_propagation';

/** Soft Ogg size cap (~4 min QualityMedium) under 256 KiB field + PN limits. */
export const VOICE_MEMO_MAX_OGG_BYTES = 240 * 1024;

/** Wire audio block from an inbound or outbound LXMF message. */
export interface LxmfAudioBlock {
  mode: number;
  data_base64: string;
  size_bytes?: number;
}

/**
 * Cap for one voice memo Ogg blob base64 payload.
 * ~240 KiB raw → ~320 KiB b64; round up with headroom.
 */
export const VOICE_MEMO_DATA_BASE64_MAX = 337_920;

/** Sidecar API paths for the memo session (dedicated IPC; not generic proxyPost). */
export const VOICE_MEMO_START_API_PATH = '/api/v1/voice/memo/start';
export const VOICE_MEMO_AUDIO_API_PATH = '/api/v1/voice/memo/audio';
export const VOICE_MEMO_STOP_API_PATH = '/api/v1/voice/memo/stop';
export const VOICE_MEMO_CANCEL_API_PATH = '/api/v1/voice/memo/cancel';

/** Cap for a single samples_b64 frame. */
export const VOICE_MEMO_SAMPLES_B64_MAX = 32_768;

export interface VoiceMemoStartResponse {
  ok: boolean;
  error?: string;
  session_id?: string;
}

/**
 * One block of raw PCM samples for the active memo recording session.
 * `channels` must be 1 (mono). `samples_b64` is float32 LE, base64-encoded.
 */
export interface VoiceMemoAudioRequest {
  session_id: string;
  channels: 1;
  samples_b64: string;
}

export interface VoiceMemoSessionRequest {
  session_id: string;
}

/** Ok/error envelope returned by memo control endpoints. */
export interface VoiceMemoOkResponse {
  ok: boolean;
  error?: string;
  session_id?: string;
  /** Finished Ogg bytes base64 (on stop). */
  ogg_base64?: string;
  duration_ms?: number;
  size_bytes?: number;
  mode?: number;
}

/** Parse/validate `reticulum:voiceMemoSendAudio` body. */
export function parseVoiceMemoAudioRequest(
  opts: unknown,
): VoiceMemoAudioRequest | { error: string } {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
    return { error: 'invalid_audio_request' };
  }
  const o = opts as Record<string, unknown>;
  if (typeof o.session_id !== 'string' || o.session_id.trim().length === 0) {
    return { error: 'invalid_session_id' };
  }
  if (o.session_id.length > 64) {
    return { error: 'session_id_too_long' };
  }
  if (o.channels !== 1) {
    return { error: 'invalid_channels' };
  }
  const samplesB64 = o.samples_b64;
  if (typeof samplesB64 !== 'string' || samplesB64.length === 0) {
    return { error: 'empty_samples_b64' };
  }
  if (samplesB64.length > VOICE_MEMO_SAMPLES_B64_MAX) {
    return { error: 'samples_b64_too_large' };
  }
  return { session_id: o.session_id, channels: 1, samples_b64: samplesB64 };
}

/** Parse/validate stop/cancel session body. */
export function parseVoiceMemoSessionRequest(
  opts: unknown,
): VoiceMemoSessionRequest | { error: string } {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
    return { error: 'invalid_session_request' };
  }
  const o = opts as Record<string, unknown>;
  if (typeof o.session_id !== 'string' || o.session_id.trim().length === 0) {
    return { error: 'invalid_session_id' };
  }
  if (o.session_id.length > 64) {
    return { error: 'session_id_too_long' };
  }
  return { session_id: o.session_id };
}

/**
 * True when a proxy API path belongs to the voice memo family.
 * These paths must be routed via `reticulum:voiceMemo*` IPC, not generic proxyPost.
 */
export function isVoiceMemoApiPath(apiPath: string): boolean {
  const pathOnly = apiPath.split('?')[0] ?? apiPath;
  return (
    pathOnly === VOICE_MEMO_START_API_PATH ||
    pathOnly === VOICE_MEMO_AUDIO_API_PATH ||
    pathOnly === VOICE_MEMO_STOP_API_PATH ||
    pathOnly === VOICE_MEMO_CANCEL_API_PATH
  );
}
