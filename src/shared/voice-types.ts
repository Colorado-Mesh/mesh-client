/** Shared LXST voice types (sidecar HTTP + WS ↔ renderer). */

export type VoiceCallRole = 'incoming' | 'outgoing';

export type VoiceSignallingStatus =
  'busy' | 'rejected' | 'calling' | 'available' | 'ringing' | 'connecting' | 'established';

export interface VoiceActiveCall {
  link_id: string;
  remote_identity: string;
  role: VoiceCallRole;
  status: VoiceSignallingStatus;
  profile?: number | null;
  answered?: boolean;
}

export interface VoiceStatusResponse {
  available: boolean;
  enabled: boolean;
  running?: boolean;
  microphone_muted?: boolean;
  codec?: string;
  reason?: string;
  active_call?: VoiceActiveCall | null;
  last_error?: string | null;
}

export interface VoiceCallRequest {
  identity_hash: string;
}

export interface VoiceOkResponse {
  ok: boolean;
  error?: string;
  identity_hash?: string;
  microphone_muted?: boolean;
  dropped?: string;
}

export interface VoiceMuteRequest {
  muted: boolean;
}

export interface VoiceAudioRequest {
  profile?: number;
  channels: number;
  samples_b64: string;
}

/** Sidecar HTTP path for renderer PCM ingest (dedicated IPC; not generic proxyPost). */
export const VOICE_AUDIO_API_PATH = '/api/v1/voice/audio';

/**
 * Cap for one PCM frame's base64 payload.
 * QualityHigh is 2880 f32 samples (~15 KiB b64); allow ~2 frames of headroom.
 */
export const VOICE_AUDIO_SAMPLES_B64_MAX = 32_768;

/** Parse/validate `reticulum:voiceSendAudio` / `/voice/audio` body. */
export function parseVoiceAudioRequest(opts: unknown): VoiceAudioRequest | { error: string } {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
    return { error: 'invalid_audio_request' };
  }
  const o = opts as Record<string, unknown>;
  const channels = o.channels;
  if (typeof channels !== 'number' || !Number.isInteger(channels) || channels < 1 || channels > 2) {
    return { error: 'invalid_channels' };
  }
  const samplesB64 = o.samples_b64;
  if (typeof samplesB64 !== 'string' || samplesB64.length === 0) {
    return { error: 'empty_samples_b64' };
  }
  if (samplesB64.length > VOICE_AUDIO_SAMPLES_B64_MAX) {
    return { error: 'samples_b64_too_large' };
  }
  let profile: number | undefined;
  if (o.profile !== undefined) {
    if (typeof o.profile !== 'number' || !Number.isFinite(o.profile)) {
      return { error: 'invalid_profile' };
    }
    profile = o.profile;
  }
  return profile === undefined
    ? { channels, samples_b64: samplesB64 }
    : { profile, channels, samples_b64: samplesB64 };
}

export interface VoiceAudioPayload {
  link_id: string;
  profile: number;
  channels: number;
  samples_b64: string;
}

const VOICE_CALL_ROLES: ReadonlySet<string> = new Set(['incoming', 'outgoing']);
const VOICE_SIGNALLING_STATUSES: ReadonlySet<string> = new Set([
  'busy',
  'rejected',
  'calling',
  'available',
  'ringing',
  'connecting',
  'established',
]);

export function isVoiceActiveCall(value: unknown): value is VoiceActiveCall {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.link_id === 'string' &&
    typeof v.remote_identity === 'string' &&
    typeof v.role === 'string' &&
    VOICE_CALL_ROLES.has(v.role) &&
    typeof v.status === 'string' &&
    VOICE_SIGNALLING_STATUSES.has(v.status)
  );
}

/** Incoming ring UI: role incoming and still ringing/available. */
export function isReticulumIncomingRinging(
  call: VoiceActiveCall | null | undefined,
): call is VoiceActiveCall {
  return call?.role === 'incoming' && (call.status === 'ringing' || call.status === 'available');
}

/** True when a non-terminal local voice session is in progress. */
export function isReticulumVoiceSessionBusy(call: VoiceActiveCall | null | undefined): boolean {
  if (!call) return false;
  return (
    call.status === 'calling' ||
    call.status === 'ringing' ||
    call.status === 'connecting' ||
    call.status === 'established' ||
    call.status === 'available'
  );
}

export function isVoiceStatusResponse(value: unknown): value is VoiceStatusResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.available === 'boolean' && typeof v.enabled === 'boolean';
}
