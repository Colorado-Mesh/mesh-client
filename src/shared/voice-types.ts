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

export interface VoiceAudioPayload {
  link_id: string;
  profile: number;
  channels: number;
  samples_b64: string;
}

export function isVoiceActiveCall(value: unknown): value is VoiceActiveCall {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.link_id === 'string' &&
    typeof v.remote_identity === 'string' &&
    typeof v.role === 'string' &&
    typeof v.status === 'string'
  );
}

export function isVoiceStatusResponse(value: unknown): value is VoiceStatusResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.available === 'boolean' && typeof v.enabled === 'boolean';
}
