// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pushAppToast } from '@/renderer/components/Toast';

import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import { useReticulumVoiceStore } from '../stores/reticulumVoiceStore';
import {
  playVoiceBusyTone,
  playVoiceFailTone,
  stopVoiceCallTones,
} from './reticulumVoiceCallTones';
import {
  handleReticulumVoiceTerminal,
  resetReticulumVoiceSessionTimersForTests,
  reticulumVoiceAnswer,
  reticulumVoiceCallPeer,
  reticulumVoiceHangup,
  reticulumVoiceReject,
  reticulumVoiceSetMuted,
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
    voiceApi.answer.mockReset();
    voiceApi.reject.mockReset();
    voiceApi.mute.mockReset();
    voiceApi.getStatus.mockResolvedValue({
      available: true,
      enabled: true,
      running: true,
    });
    voiceApi.call.mockResolvedValue({ ok: true, identity_hash: 'a'.repeat(32) });
    voiceApi.hangup.mockResolvedValue({ ok: true });
    voiceApi.answer.mockResolvedValue({ ok: true });
    voiceApi.reject.mockResolvedValue({ ok: true });
    voiceApi.mute.mockResolvedValue({ ok: true, microphone_muted: true });
    vi.mocked(pushAppToast).mockReset();
    vi.mocked(playVoiceFailTone).mockReset();
    vi.mocked(playVoiceBusyTone).mockReset();
    vi.mocked(stopVoiceCallTones).mockReset();
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

  it('blocks a second dial while a call is active', async () => {
    useReticulumVoiceStore.getState().beginOutgoing('d'.repeat(32));
    await reticulumVoiceCallPeer('e'.repeat(32));
    expect(voiceApi.call).not.toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalled();
  });

  it('clears optimistic call and plays fail tone when call IPC returns ok false', async () => {
    voiceApi.call.mockResolvedValue({ ok: false, error: 'voice not available' });
    await reticulumVoiceCallPeer('f'.repeat(32));
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    expect(playVoiceFailTone).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalled();
  });

  it('hangup clears optimistic calling even without WS', async () => {
    useReticulumVoiceStore.getState().beginOutgoing('d'.repeat(32));
    await reticulumVoiceHangup();
    expect(voiceApi.hangup).toHaveBeenCalled();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('hangup leaves call active when IPC fails', async () => {
    useReticulumVoiceStore.getState().beginOutgoing('d'.repeat(32));
    voiceApi.hangup.mockResolvedValue({ ok: false, error: 'voice control closed' });
    await reticulumVoiceHangup();
    expect(useReticulumVoiceStore.getState().activeCall?.status).toBe('calling');
  });

  it('reject clears only after successful IPC', async () => {
    useReticulumVoiceStore.getState().applyIncoming({
      link_id: '1'.repeat(32),
      remote_identity: '2'.repeat(32),
      role: 'incoming',
      status: 'ringing',
      answered: false,
    });
    await reticulumVoiceReject();
    expect(voiceApi.reject).toHaveBeenCalled();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('reject leaves incoming when IPC fails', async () => {
    useReticulumVoiceStore.getState().applyIncoming({
      link_id: '1'.repeat(32),
      remote_identity: '2'.repeat(32),
      role: 'incoming',
      status: 'ringing',
      answered: false,
    });
    voiceApi.reject.mockResolvedValue({ ok: false, error: 'voice not available' });
    await reticulumVoiceReject();
    expect(useReticulumVoiceStore.getState().incomingCall?.status).toBe('ringing');
  });

  it('answer does not start media when IPC fails', async () => {
    voiceApi.answer.mockResolvedValue({ ok: false, error: 'voice not available' });
    await reticulumVoiceAnswer();
    expect(pushAppToast).toHaveBeenCalled();
  });

  it('mute updates store only when IPC succeeds', async () => {
    voiceApi.mute.mockResolvedValue({ ok: false, error: 'voice not available' });
    await reticulumVoiceSetMuted(true);
    expect(useReticulumVoiceStore.getState().microphoneMuted).toBe(false);
    voiceApi.mute.mockResolvedValue({ ok: true, microphone_muted: true });
    await reticulumVoiceSetMuted(true);
    expect(useReticulumVoiceStore.getState().microphoneMuted).toBe(true);
  });

  it('terminal established reason completes without fail tone', () => {
    useReticulumVoiceStore.getState().applyUpdate({
      type: 'outgoing',
      link_id: '1'.repeat(32),
      remote_identity: '2'.repeat(32),
    });
    handleReticulumVoiceTerminal({ linkId: '1'.repeat(32), reason: 'established' });
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    expect(playVoiceFailTone).not.toHaveBeenCalled();
    expect(playVoiceBusyTone).not.toHaveBeenCalled();
  });

  it('terminal busy plays busy tone and toasts', () => {
    useReticulumVoiceStore.getState().applyUpdate({
      type: 'outgoing',
      link_id: '1'.repeat(32),
      remote_identity: '2'.repeat(32),
    });
    handleReticulumVoiceTerminal({ linkId: '1'.repeat(32), reason: 'busy' });
    expect(playVoiceBusyTone).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalled();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('ignores stale terminal for a different link_id', () => {
    useReticulumVoiceStore.getState().applyUpdate({
      type: 'outgoing',
      link_id: '1'.repeat(32),
      remote_identity: '2'.repeat(32),
    });
    handleReticulumVoiceTerminal({ linkId: '9'.repeat(32), reason: 'busy' });
    expect(useReticulumVoiceStore.getState().activeCall?.link_id).toBe('1'.repeat(32));
    expect(playVoiceBusyTone).not.toHaveBeenCalled();
  });

  it('hangup with busy terminalReason plays busy tone', async () => {
    useReticulumVoiceStore.getState().beginOutgoing('d'.repeat(32));
    await reticulumVoiceHangup({ terminalReason: 'busy' });
    expect(playVoiceBusyTone).toHaveBeenCalled();
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
    const { syncReticulumVoiceProgressTones } = await import('./reticulumVoiceSession');
    syncReticulumVoiceProgressTones('established');
    await vi.advanceTimersByTimeAsync(RETICULUM_VOICE_OUTGOING_SAFETY_HANGUP_MS + 10);
    expect(voiceApi.hangup).not.toHaveBeenCalled();
  });
});
