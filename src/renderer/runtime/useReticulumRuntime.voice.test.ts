// @vitest-environment jsdom
/**
 * Behavioral tests for LXST voice WebSocket / voiceAudio event routing.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/renderer/lib/i18n';
import { resetReticulumManualStackStopSuppressForTests } from '@/renderer/lib/reticulum/reticulumManualStackStopSuppress';
import { encodeF32LeBase64 } from '@/renderer/lib/reticulumVoiceAudio';
import { useReticulumRuntime } from '@/renderer/runtime/useReticulumRuntime';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

vi.mock('@/renderer/lib/reticulum/fetchRecentInboundLxmf', () => ({
  fetchRecentInboundLxmf: vi.fn().mockResolvedValue([]),
  fetchRecentInboundLxmfDetailed: vi.fn().mockResolvedValue({ messages: [], ringLen: 0 }),
}));

vi.mock('@/renderer/lib/reticulum/useReticulumNobleBleYieldWatcher', () => ({
  useReticulumNobleBleYieldWatcher: () => {},
}));

vi.mock('@/renderer/lib/reticulum/useReticulumPropagationAutoSync', () => ({
  useReticulumPropagationAutoSync: () => {},
}));

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/renderer/lib/reticulumVoiceCallTones', () => ({
  startVoiceRingback: vi.fn(),
  stopVoiceCallTones: vi.fn(),
  playVoiceBusyTone: vi.fn(),
  playVoiceFailTone: vi.fn(),
  syncReticulumVoiceProgressTones: vi.fn(),
}));

const CALL = {
  link_id: 'a'.repeat(32),
  remote_identity: 'b'.repeat(32),
  role: 'incoming' as const,
  status: 'ringing' as const,
  answered: false,
};

describe('useReticulumRuntime voice event routing', () => {
  let eventHandler: ((evt: ReticulumSidecarEvent) => void) | null = null;
  let voiceAudioHandler: ((evt: ReticulumSidecarEvent) => void) | null = null;

  beforeEach(() => {
    resetReticulumManualStackStopSuppressForTests();
    useReticulumVoiceStore.getState().clearCall();
    eventHandler = null;
    voiceAudioHandler = null;
    vi.mocked(window.electronAPI.reticulum.onEvent).mockImplementation((cb) => {
      eventHandler = cb;
      return () => {
        if (eventHandler === cb) eventHandler = null;
      };
    });
    vi.mocked(window.electronAPI.reticulum.onVoiceAudio).mockImplementation((cb) => {
      voiceAudioHandler = cb;
      return () => {
        if (voiceAudioHandler === cb) voiceAudioHandler = null;
      };
    });
    vi.mocked(window.electronAPI.reticulum.start).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
    });
    vi.mocked(window.electronAPI.reticulum.stop).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
      healthy: true,
    });
  });

  afterEach(() => {
    vi.mocked(window.electronAPI.reticulum.onEvent).mockReset();
    vi.mocked(window.electronAPI.reticulum.onEvent).mockReturnValue(() => {});
    vi.mocked(window.electronAPI.reticulum.onVoiceAudio).mockReset();
    vi.mocked(window.electronAPI.reticulum.onVoiceAudio).mockReturnValue(() => {});
    useReticulumVoiceStore.getState().clearCall();
  });

  async function connectAndGetHandlers() {
    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });
    expect(eventHandler).toBeTruthy();
    expect(voiceAudioHandler).toBeTruthy();
    return { onEvent: eventHandler!, onVoiceAudio: voiceAudioHandler!, unmount };
  }

  it('routes voice.update / incoming / terminated / error and delivers decoded audio', async () => {
    const { onEvent, onVoiceAudio, unmount } = await connectAndGetHandlers();

    act(() => {
      onEvent({ type: 'voice.incoming', payload: CALL });
    });
    expect(useReticulumVoiceStore.getState().incomingCall?.status).toBe('ringing');
    expect(useReticulumVoiceStore.getState().activeCall?.remote_identity).toBe(
      CALL.remote_identity,
    );

    act(() => {
      onEvent({
        type: 'voice.update',
        payload: {
          type: 'snapshot',
          active_call: { ...CALL, status: 'established', answered: true },
        },
      });
    });
    expect(useReticulumVoiceStore.getState().activeCall?.status).toBe('established');
    expect(useReticulumVoiceStore.getState().incomingCall).toBeNull();

    const heard: Float32Array[] = [];
    const unsub = useReticulumVoiceStore.getState().subscribeAudio((_ch, samples) => {
      heard.push(samples);
    });
    const pcm = new Float32Array([0.25, -0.5, 0]);
    act(() => {
      onVoiceAudio({
        type: 'voice.audio',
        payload: {
          link_id: CALL.link_id,
          profile: 0x50,
          channels: 1.5, // non-integer → default to 1
          samples_b64: encodeF32LeBase64(pcm),
        },
      });
    });
    expect(heard).toHaveLength(1);
    expect(heard[0]?.[0]).toBeCloseTo(0.25);
    expect(heard[0]?.[1]).toBeCloseTo(-0.5);
    unsub();

    act(() => {
      onEvent({
        type: 'voice.terminated',
        payload: { link_id: CALL.link_id, reason: 'hangup' },
      });
    });
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();

    act(() => {
      onEvent({ type: 'voice.incoming', payload: CALL });
    });
    act(() => {
      onEvent({ type: 'voice.error', payload: { message: 'codec boom' } });
    });
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    // Sidecar English is humanized — never stored/toasted raw.
    expect(useReticulumVoiceStore.getState().lastError).toBe(
      i18n.t('reticulumVoice.errors.callFailed'),
    );

    unmount();
  });
});
