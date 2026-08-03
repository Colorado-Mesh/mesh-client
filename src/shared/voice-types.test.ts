import { describe, expect, it } from 'vitest';

import { isVoiceActiveCall, isVoiceStatusResponse } from './voice-types';

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

  it('rejects incomplete active_call', () => {
    expect(isVoiceActiveCall({ link_id: 'x' })).toBe(false);
  });
});
