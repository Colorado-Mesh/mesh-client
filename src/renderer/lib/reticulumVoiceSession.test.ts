// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import { useReticulumVoiceStore } from '../stores/reticulumVoiceStore';
import {
  resetReticulumVoiceSessionTimersForTests,
  reticulumVoiceCallPeer,
  reticulumVoiceHangup,
} from './reticulumVoiceSession';
import { RETICULUM_VOICE_OUTGOING_SAFETY_HANGUP_MS } from './timeConstants';

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

vi.mock('./reticulumVoiceCallTones', () => ({
  startVoiceRingback: vi.fn(),
  stopVoiceCallTones: vi.fn(),
  playVoiceBusyTone: vi.fn(),
  playVoiceFailTone: vi.fn(),
}));

const voiceApi = {
  getStatus: vi.fn(),
  call: vi.fn(),
  hangup: vi.fn(),
  answer: vi.fn(),
  reject: vi.fn(),
  mute: vi.fn(),
  sendAudio: vi.fn(),
};

describe('reticulumVoiceSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetReticulumVoiceSessionTimersForTests();
    useReticulumVoiceStore.getState().clearCall();
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map(),
      history: new Map(),
    });
    voiceApi.getStatus.mockReset();
    voiceApi.call.mockReset();
    voiceApi.hangup.mockReset();
    voiceApi.getStatus.mockResolvedValue({
      available: true,
      enabled: true,
      running: true,
    });
    voiceApi.call.mockResolvedValue({ ok: true, identity_hash: 'a'.repeat(32) });
    voiceApi.hangup.mockResolvedValue({ ok: true });
    Object.assign(window, {
      electronAPI: {
        reticulum: { voice: voiceApi },
        media: {
          ensureMicrophoneAccess: vi.fn(() =>
            Promise.resolve({ granted: true, status: 'granted' }),
          ),
        },
      },
    });
  });

  afterEach(() => {
    resetReticulumVoiceSessionTimersForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('dials with peer identity_hash and sets optimistic calling without mic helper', async () => {
    const dest = 'b'.repeat(32);
    const id = 'a'.repeat(32);
    useReticulumPeerStore.getState().updatePeer(dest, {
      destination_hash: dest,
      identity_hash: id,
    });
    await reticulumVoiceCallPeer(dest);
    expect(voiceApi.call).toHaveBeenCalledWith({ identity_hash: id });
    expect(useReticulumVoiceStore.getState().activeCall?.status).toBe('calling');
  });

  it('falls back to destination hash when identity unknown', async () => {
    const dest = 'c'.repeat(32);
    await reticulumVoiceCallPeer(dest);
    expect(voiceApi.call).toHaveBeenCalledWith({ identity_hash: dest });
    expect(useReticulumVoiceStore.getState().activeCall?.status).toBe('calling');
  });

  it('hangup clears optimistic calling even without WS', async () => {
    useReticulumVoiceStore.getState().beginOutgoing('d'.repeat(32));
    await reticulumVoiceHangup();
    expect(voiceApi.hangup).toHaveBeenCalled();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('safety hangup fires after timeout when never established', async () => {
    const dest = 'e'.repeat(32);
    await reticulumVoiceCallPeer(dest);
    expect(useReticulumVoiceStore.getState().activeCall?.status).toBe('calling');
    await vi.advanceTimersByTimeAsync(RETICULUM_VOICE_OUTGOING_SAFETY_HANGUP_MS + 10);
    expect(voiceApi.hangup).toHaveBeenCalled();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('safety hangup does not fire after established', async () => {
    const dest = 'f'.repeat(32);
    await reticulumVoiceCallPeer(dest);
    useReticulumVoiceStore.getState().applyUpdate({
      type: 'snapshot',
      active_call: {
        link_id: '1'.repeat(32),
        remote_identity: dest,
        role: 'outgoing',
        status: 'established',
      },
    });
    // Overlay/sync would clear timer on established; simulate hangup path clear via store status.
    // Manually clear by calling hangup cancel through sync — establish via applying status then advance.
    const { syncReticulumVoiceProgressTones } = await import('./reticulumVoiceSession');
    syncReticulumVoiceProgressTones('established');
    await vi.advanceTimersByTimeAsync(RETICULUM_VOICE_OUTGOING_SAFETY_HANGUP_MS + 10);
    expect(voiceApi.hangup).not.toHaveBeenCalled();
  });
});
