// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pushAppToast } from '@/renderer/components/Toast';

import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import { useReticulumVoiceStore } from '../stores/reticulumVoiceStore';
import {
  playVoiceBusyTone,
  playVoiceFailTone,
  startVoiceDialTone,
  startVoiceRingback,
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
  startReticulumVoiceMediaForActiveCall,
  stopReticulumVoiceMedia,
  syncReticulumVoiceProgressTones,
} from './reticulumVoiceSession';
import { RETICULUM_VOICE_OUTGOING_SAFETY_HANGUP_MS } from './timeConstants';

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

vi.mock('./reticulumVoiceCallTones', () => ({
  startVoiceDialTone: vi.fn(),
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
    vi.mocked(startVoiceDialTone).mockReset();
    vi.mocked(startVoiceRingback).mockReset();
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

  it('dials with peer identity_hash and starts dial tone not ringback', async () => {
    const dest = 'b'.repeat(32);
    const id = 'a'.repeat(32);
    useReticulumPeerStore.getState().updatePeer(dest, {
      destination_hash: dest,
      identity_hash: id,
    });
    await reticulumVoiceCallPeer(dest);
    expect(voiceApi.call).toHaveBeenCalledWith({ identity_hash: id });
    expect(useReticulumVoiceStore.getState().activeCall?.status).toBe('calling');
    expect(startVoiceDialTone).toHaveBeenCalled();
    expect(startVoiceRingback).not.toHaveBeenCalled();
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

  it('clears optimistic call and toasts when voice is not available', async () => {
    voiceApi.call.mockResolvedValue({ ok: false, error: 'voice not available' });
    await reticulumVoiceCallPeer('f'.repeat(32));
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    expect(pushAppToast).toHaveBeenCalled();
    expect(voiceApi.hangup).toHaveBeenCalled();
  });

  it('clears optimistic call with busy tone on connect-style dial failure', async () => {
    voiceApi.call.mockResolvedValue({ ok: false, error: 'discovery failed' });
    await reticulumVoiceCallPeer('f'.repeat(32));
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    expect(playVoiceBusyTone).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalled();
  });

  it('syncReticulumVoiceProgressTones maps calling→dial and connecting→ringback', () => {
    syncReticulumVoiceProgressTones('calling');
    expect(startVoiceDialTone).toHaveBeenCalled();
    expect(startVoiceRingback).not.toHaveBeenCalled();
    vi.mocked(startVoiceDialTone).mockClear();
    syncReticulumVoiceProgressTones('connecting');
    expect(startVoiceRingback).toHaveBeenCalled();
    syncReticulumVoiceProgressTones('ringing');
    expect(startVoiceRingback).toHaveBeenCalled();
    vi.mocked(stopVoiceCallTones).mockClear();
    syncReticulumVoiceProgressTones('established');
    expect(stopVoiceCallTones).toHaveBeenCalled();
  });

  it('voice.error connect-fail plays busy tone, toasts, and hangs up', () => {
    useReticulumVoiceStore.getState().beginOutgoing('2'.repeat(32));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleReticulumVoiceTerminal({
      errorMessage: 'active call is not established',
    });
    expect(playVoiceBusyTone).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalled();
    expect(voiceApi.hangup).toHaveBeenCalled();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    warnSpy.mockRestore();
  });

  it('terminal rejected plays fail tone without toast', () => {
    useReticulumVoiceStore.getState().applyUpdate({
      type: 'outgoing',
      link_id: '1'.repeat(32),
      remote_identity: '2'.repeat(32),
    });
    handleReticulumVoiceTerminal({ linkId: '1'.repeat(32), reason: 'rejected' });
    expect(playVoiceFailTone).toHaveBeenCalled();
    expect(pushAppToast).not.toHaveBeenCalled();
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

  it('outgoing terminated with null reason plays busy tone and connect-failed toast', () => {
    useReticulumVoiceStore.getState().applyUpdate({
      type: 'outgoing',
      link_id: '1'.repeat(32),
      remote_identity: '2'.repeat(32),
    });
    handleReticulumVoiceTerminal({ linkId: '1'.repeat(32), reason: null });
    expect(playVoiceBusyTone).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalled();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('outgoing terminated with terminated reason plays busy tone and toasts', () => {
    // beginOutgoing has empty link_id; terminate without link_id matches pending outgoing.
    useReticulumVoiceStore.getState().beginOutgoing('2'.repeat(32));
    handleReticulumVoiceTerminal({ reason: 'terminated' });
    expect(playVoiceBusyTone).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalled();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('established then terminated with null reason completes silently', () => {
    useReticulumVoiceStore.getState().applyUpdate({
      type: 'snapshot',
      active_call: {
        link_id: '1'.repeat(32),
        remote_identity: '2'.repeat(32),
        role: 'outgoing',
        status: 'established',
        answered: true,
      },
    });
    handleReticulumVoiceTerminal({ linkId: '1'.repeat(32), reason: null });
    expect(playVoiceBusyTone).not.toHaveBeenCalled();
    expect(playVoiceFailTone).not.toHaveBeenCalled();
    expect(pushAppToast).not.toHaveBeenCalled();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('ignores stale terminal for a different link_id', () => {
    useReticulumVoiceStore.getState().applyUpdate({
      type: 'outgoing',
      link_id: '1'.repeat(32),
      remote_identity: '2'.repeat(32),
    });
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    handleReticulumVoiceTerminal({ linkId: '9'.repeat(32), reason: 'busy' });
    expect(useReticulumVoiceStore.getState().activeCall?.link_id).toBe('1'.repeat(32));
    expect(playVoiceBusyTone).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      '[reticulumVoice] ignoring stale terminal event',
      expect.stringContaining('"linkId":"99999999999999999999999999999999"'),
    );
    debugSpy.mockRestore();
  });

  it('logs voice.error message as JSON string for developer bundles', () => {
    useReticulumVoiceStore.getState().applyIncoming({
      link_id: '1'.repeat(32),
      remote_identity: '2'.repeat(32),
      role: 'incoming',
      status: 'ringing',
      answered: false,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleReticulumVoiceTerminal({
      linkId: '1'.repeat(32),
      errorMessage: 'codec boom',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[reticulumVoice] voice.error message="codec boom"'),
    );
    warnSpy.mockRestore();
  });

  it('coalesces concurrent media starts for the same callGeneration', async () => {
    vi.useRealTimers();
    let getUserMediaCalls = 0;
    let resolveMedia!: (stream: MediaStream) => void;
    const mediaGate = new Promise<MediaStream>((resolve) => {
      resolveMedia = resolve;
    });
    const track = { stop: vi.fn() };
    const fakeStream = { getTracks: () => [track] } as unknown as MediaStream;

    class FakeAudioContext {
      state = 'running';
      destination = {};
      currentTime = 0;
      sampleRate = 48000;
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createScriptProcessor() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
          onaudioprocess: null as unknown,
        };
      }
      createGain() {
        return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } };
      }
      createBuffer(_channels: number, frames: number) {
        return {
          duration: frames / 48000,
          copyToChannel: vi.fn(),
        };
      }
      createBufferSource() {
        return { buffer: null as unknown, connect: vi.fn(), start: vi.fn() };
      }
      resume = vi.fn(() => Promise.resolve());
      close = vi.fn(() => Promise.resolve());
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          getUserMediaCalls += 1;
          return mediaGate;
        }),
      },
    });
    vi.stubGlobal('AudioContext', FakeAudioContext);

    useReticulumVoiceStore.getState().applyIncoming({
      link_id: '1'.repeat(32),
      remote_identity: '2'.repeat(32),
      role: 'incoming',
      status: 'connecting',
      answered: true,
    });

    const a = startReticulumVoiceMediaForActiveCall();
    const b = startReticulumVoiceMediaForActiveCall();
    // Wait until the single-flight path reaches getUserMedia.
    await vi.waitFor(() => {
      expect(getUserMediaCalls).toBe(1);
    });
    resolveMedia(fakeStream);
    await Promise.all([a, b]);
    expect(getUserMediaCalls).toBe(1);

    await startReticulumVoiceMediaForActiveCall();
    expect(getUserMediaCalls).toBe(1);

    stopReticulumVoiceMedia();
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
    expect(playVoiceBusyTone).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalled();
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
    syncReticulumVoiceProgressTones('established');
    await vi.advanceTimersByTimeAsync(RETICULUM_VOICE_OUTGOING_SAFETY_HANGUP_MS + 10);
    expect(voiceApi.hangup).not.toHaveBeenCalled();
  });

  it('safety hangup still fires when activeCall was cleared without feedback', async () => {
    const dest = 'a'.repeat(32);
    await reticulumVoiceCallPeer(dest);
    const generation = useReticulumVoiceStore.getState().callGeneration;
    // Silent wipe (e.g. snapshot null) without terminal feedback — timer still armed.
    useReticulumVoiceStore.getState().clearCall();
    // clearCall does not bump generation; restore generation so safety matches.
    useReticulumVoiceStore.setState({ callGeneration: generation });
    await vi.advanceTimersByTimeAsync(RETICULUM_VOICE_OUTGOING_SAFETY_HANGUP_MS + 10);
    expect(voiceApi.hangup).toHaveBeenCalled();
    expect(playVoiceBusyTone).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalled();
  });
});
