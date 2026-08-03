import { create } from 'zustand';

import type { VoiceActiveCall } from '@/shared/voice-types';
import { isVoiceActiveCall } from '@/shared/voice-types';

export type VoiceAudioListener = (channels: number, samples: Float32Array) => void;

interface ReticulumVoiceStoreState {
  enabled: boolean;
  running: boolean;
  microphoneMuted: boolean;
  activeCall: VoiceActiveCall | null;
  incomingCall: VoiceActiveCall | null;
  lastError: string | null;
  /** Generation bumped on each new call so stale terminated events can be ignored. */
  callGeneration: number;
  audioListeners: Set<VoiceAudioListener>;

  applyStatus: (status: {
    enabled?: boolean;
    running?: boolean;
    microphone_muted?: boolean;
    active_call?: unknown;
    last_error?: string | null;
  }) => void;
  applyIncoming: (call: unknown) => void;
  applyUpdate: (payload: unknown) => void;
  applyTerminated: (linkId?: string | null) => void;
  applyError: (message: string) => void;
  setMicrophoneMuted: (muted: boolean) => void;
  clearCall: () => void;
  subscribeAudio: (listener: VoiceAudioListener) => () => void;
  emitAudio: (channels: number, samples: Float32Array) => void;
}

function asActiveCall(value: unknown): VoiceActiveCall | null {
  return isVoiceActiveCall(value) ? value : null;
}

export const useReticulumVoiceStore = create<ReticulumVoiceStoreState>((set, get) => ({
  enabled: false,
  running: false,
  microphoneMuted: false,
  activeCall: null,
  incomingCall: null,
  lastError: null,
  callGeneration: 0,
  audioListeners: new Set(),

  applyStatus: (status) => {
    set((s) => ({
      enabled: status.enabled ?? s.enabled,
      running: status.running ?? s.running,
      microphoneMuted: status.microphone_muted ?? s.microphoneMuted,
      activeCall:
        status.active_call === undefined ? s.activeCall : asActiveCall(status.active_call),
      lastError: status.last_error === undefined ? s.lastError : (status.last_error ?? null),
    }));
  },

  applyIncoming: (call) => {
    const active = asActiveCall(call);
    if (!active) return;
    set((s) => ({
      incomingCall: active,
      activeCall: active,
      lastError: null,
      callGeneration: s.callGeneration + 1,
    }));
  },

  applyUpdate: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Record<string, unknown>;
    if (p.type === 'snapshot' && 'active_call' in p) {
      const active = asActiveCall(p.active_call);
      set((s) => ({
        activeCall: active,
        incomingCall:
          active?.role === 'incoming' && active.status === 'ringing' ? active : s.incomingCall,
        lastError: null,
      }));
      return;
    }
    if (p.type === 'outgoing_pending' || p.type === 'outgoing') {
      const remote = typeof p.remote_identity === 'string' ? p.remote_identity.toLowerCase() : null;
      if (!remote) return;
      const linkId = typeof p.link_id === 'string' ? p.link_id : '';
      set((s) => ({
        activeCall: {
          link_id: linkId,
          remote_identity: remote,
          role: 'outgoing',
          status: p.type === 'outgoing_pending' ? 'calling' : 'connecting',
          answered: false,
        },
        incomingCall: null,
        lastError: null,
        callGeneration: s.callGeneration + 1,
      }));
    }
  },

  applyTerminated: (linkId) => {
    set((s) => {
      if (
        linkId &&
        s.activeCall?.link_id &&
        s.activeCall.link_id.toLowerCase() !== linkId.toLowerCase()
      ) {
        // Stale terminate for a previous call.
        return s;
      }
      return {
        activeCall: null,
        incomingCall: null,
      };
    });
  },

  applyError: (message) => {
    set({ lastError: message, activeCall: null, incomingCall: null });
  },

  setMicrophoneMuted: (muted) => {
    set({ microphoneMuted: muted });
  },

  clearCall: () => {
    set({ activeCall: null, incomingCall: null, lastError: null });
  },

  subscribeAudio: (listener) => {
    set((s) => {
      const audioListeners = new Set(s.audioListeners);
      audioListeners.add(listener);
      return { audioListeners };
    });
    return () => {
      set((s) => {
        const audioListeners = new Set(s.audioListeners);
        audioListeners.delete(listener);
        return { audioListeners };
      });
    };
  },

  emitAudio: (channels, samples) => {
    for (const listener of get().audioListeners) {
      listener(channels, samples);
    }
  },
}));
