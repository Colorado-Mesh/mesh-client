import { describe, expect, it } from 'vitest';

import {
  isReticulumIncomingRinging,
  isReticulumVoiceSessionBusy,
  isVoiceActiveCall,
  isVoiceStatusResponse,
  parseVoiceAudioRequest,
  VOICE_AUDIO_SAMPLES_B64_MAX,
} from './voice-types';

describe('voice-types guards', () => {
  it('accepts a valid status snapshot', () => {
    expect(
      isVoiceStatusResponse({
        available: true,
        enabled: true,
        running: true,
        codec: 'opus',
        active_call: null,
      }),
    ).toBe(true);
  });

  it('rejects garbage status', () => {
    expect(isVoiceStatusResponse(null)).toBe(false);
    expect(isVoiceStatusResponse({ available: true })).toBe(false);
    expect(isVoiceStatusResponse({ available: 'yes', enabled: true })).toBe(false);
  });

  it('accepts active_call shape', () => {
    expect(
      isVoiceActiveCall({
        link_id: 'a'.repeat(32),
        remote_identity: 'b'.repeat(32),
        role: 'incoming',
        status: 'ringing',
      }),
    ).toBe(true);
  });

  it('rejects incomplete or unsupported active_call enums', () => {
    expect(isVoiceActiveCall({ link_id: 'x' })).toBe(false);
    expect(
      isVoiceActiveCall({
        link_id: 'a'.repeat(32),
        remote_identity: 'b'.repeat(32),
        role: 'peer',
        status: 'ringing',
      }),
    ).toBe(false);
    expect(
      isVoiceActiveCall({
        link_id: 'a'.repeat(32),
        remote_identity: 'b'.repeat(32),
        role: 'incoming',
        status: 'unknown',
      }),
    ).toBe(false);
  });

  it('parseVoiceAudioRequest accepts a QualityHigh-shaped frame', () => {
    expect(
      parseVoiceAudioRequest({
        profile: 0x50,
        channels: 1,
        samples_b64: 'AAAA',
      }),
    ).toEqual({ profile: 0x50, channels: 1, samples_b64: 'AAAA' });
  });

  it('parseVoiceAudioRequest rejects empty or oversized samples', () => {
    expect(parseVoiceAudioRequest({ channels: 1, samples_b64: '' })).toEqual({
      error: 'empty_samples_b64',
    });
    expect(
      parseVoiceAudioRequest({
        channels: 1,
        samples_b64: 'A'.repeat(VOICE_AUDIO_SAMPLES_B64_MAX + 1),
      }),
    ).toEqual({ error: 'samples_b64_too_large' });
  });

  it('classifies incoming ringing and session busy', () => {
    const ringing = {
      link_id: 'a'.repeat(32),
      remote_identity: 'b'.repeat(32),
      role: 'incoming' as const,
      status: 'ringing' as const,
    };
    expect(isReticulumIncomingRinging(ringing)).toBe(true);
    expect(isReticulumIncomingRinging({ ...ringing, status: 'established' })).toBe(false);
    expect(isReticulumVoiceSessionBusy(ringing)).toBe(true);
    expect(isReticulumVoiceSessionBusy(null)).toBe(false);
  });
});
