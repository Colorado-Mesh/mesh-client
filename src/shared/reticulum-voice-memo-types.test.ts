import { describe, expect, it } from 'vitest';

import {
  isVoiceMemoApiPath,
  parseVoiceMemoAudioRequest,
  parseVoiceMemoSessionRequest,
  RETICULUM_MESSAGE_TOO_LARGE_FOR_PROPAGATION,
  VOICE_MEMO_AUDIO_API_PATH,
  VOICE_MEMO_START_API_PATH,
} from './reticulum-voice-memo-types';

describe('reticulum-voice-memo-types', () => {
  it('exports the too-large-for-propagation error code', () => {
    expect(RETICULUM_MESSAGE_TOO_LARGE_FOR_PROPAGATION).toBe('message_too_large_for_propagation');
  });

  it('parses valid audio and session requests', () => {
    const audio = parseVoiceMemoAudioRequest({
      session_id: 'abc',
      channels: 1,
      samples_b64: 'AAAA',
    });
    expect(audio).toEqual({ session_id: 'abc', channels: 1, samples_b64: 'AAAA' });
    expect(parseVoiceMemoSessionRequest({ session_id: 'abc' })).toEqual({ session_id: 'abc' });
  });

  it('rejects invalid audio requests', () => {
    expect(parseVoiceMemoAudioRequest({})).toEqual({ error: 'invalid_session_id' });
    expect(
      parseVoiceMemoAudioRequest({ session_id: 'abc', channels: 2, samples_b64: 'AA' }),
    ).toEqual({ error: 'invalid_channels' });
  });

  it('detects memo API paths', () => {
    expect(isVoiceMemoApiPath(VOICE_MEMO_START_API_PATH)).toBe(true);
    expect(isVoiceMemoApiPath(VOICE_MEMO_AUDIO_API_PATH)).toBe(true);
    expect(isVoiceMemoApiPath(`${VOICE_MEMO_START_API_PATH}?foo=1`)).toBe(true);
    expect(isVoiceMemoApiPath('/api/v1/voice/audio')).toBe(false);
  });
});
