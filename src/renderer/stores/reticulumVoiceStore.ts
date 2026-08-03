import { create } from 'zustand';

import type { VoiceActiveCall } from '@/shared/voice-types';
import { isVoiceActiveCall } from '@/shared/voice-types';

export type VoiceAudioListener = (channels: number, samples: Float32Array) => void;

export interface VoiceCallStats {
  txFrames: number;
  txPackets: number;
  rxFrames: number;
  localTxDrops: number;
}

export type VoiceTerminalReason = string | null;

interface ReticulumVoiceStoreState {
  enabled: boolean;
  running: boolean;
  microphoneMuted: boolean;
  activeCall: VoiceActiveCall | null;
  incomingCall: VoiceActiveCall | null;
  lastError: string | null;
  /** Last terminal reason (busy / rejected / timeout / …) for tones/toasts. */
  lastTerminalReason: VoiceTerminalReason;
  /** Wall-clock ms when the local session began (dial / incoming). */
  callStartedAtMs: number | null;
  /** Wall-clock ms when status first became established (for RX gap estimate). */
  callEstablishedAtMs: number | null;
  stats: VoiceCallStats;
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
  beginOutgoing: (remoteIdentity: string) => void;
  applyIncoming: (call: unknown) => void;
  applyUpdate: (payload: unknown) => void;
  applyStats: (payload: unknown) => void;
  applyTerminated: (linkId?: string | null, reason?: string | null) => void;
  applyError: (message: string) => void;
  incrementLocalTxDrops: () => void;
  setMicrophoneMuted: (muted: boolean) => void;
  clearCall: () => void;
  subscribeAudio: (listener: VoiceAudioListener) => () => void;
  emitAudio: (channels: number, samples: Float32Array) => void;
}

const EMPTY_STATS: VoiceCallStats = {
  txFrames: 0,
  txPackets: 0,
  rxFrames: 0,
  localTxDrops: 0,
};

function asActiveCall(value: unknown): VoiceActiveCall | null {
  return isVoiceActiveCall(value) ? value : null;
}

/** Keep incomingCall only while the call is still ringing / available. */
function incomingFromActive(active: VoiceActiveCall | null): VoiceActiveCall | null {
  if (
    active?.role === 'incoming' &&
    (active.status === 'ringing' || active.status === 'available')
  ) {
    return active;
  }
  return null;
}

function resetSessionFields(): Pick<
  ReticulumVoiceStoreState,
  | 'activeCall'
  | 'incomingCall'
  | 'lastError'
  | 'lastTerminalReason'
  | 'callStartedAtMs'
  | 'callEstablishedAtMs'
  | 'stats'
> {
  return {
    activeCall: null,
    incomingCall: null,
    lastError: null,
    lastTerminalReason: null,
    callStartedAtMs: null,
    callEstablishedAtMs: null,
    stats: { ...EMPTY_STATS },
  };
}

export const useReticulumVoiceStore = create<ReticulumVoiceStoreState>((set, get) => ({
  enabled: false,
  running: false,
  microphoneMuted: false,
  activeCall: null,
  incomingCall: null,
  lastError: null,
  lastTerminalReason: null,
  callStartedAtMs: null,
  callEstablishedAtMs: null,
  stats: { ...EMPTY_STATS },
  callGeneration: 0,
  audioListeners: new Set(),

  applyStatus: (status) => {
    set((s) => {
      const nextActive =
        status.active_call === undefined ? s.activeCall : asActiveCall(status.active_call);
      const nextIncoming =
        status.active_call === undefined ? s.incomingCall : incomingFromActive(nextActive);
      return {
        enabled: status.enabled ?? s.enabled,
        running: status.running ?? s.running,
        microphoneMuted: status.microphone_muted ?? s.microphoneMuted,
        activeCall: nextActive,
        incomingCall: nextIncoming,
        lastError: status.last_error === undefined ? s.lastError : (status.last_error ?? null),
        callEstablishedAtMs:
          nextActive?.status === 'established' && s.callEstablishedAtMs == null
            ? Date.now()
            : s.callEstablishedAtMs,
      };
    });
  },

  beginOutgoing: (remoteIdentity) => {
    const remote = remoteIdentity.trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(remote)) return;
    set((s) => ({
      activeCall: {
        link_id: '',
        remote_identity: remote,
        role: 'outgoing',
        status: 'calling',
        answered: false,
      },
      incomingCall: null,
      lastError: null,
      lastTerminalReason: null,
      callStartedAtMs: Date.now(),
      callEstablishedAtMs: null,
      stats: { ...EMPTY_STATS },
      callGeneration: s.callGeneration + 1,
    }));
  },

  applyIncoming: (call) => {
    const active = asActiveCall(call);
    if (!active) return;
    set((s) => ({
      incomingCall: active,
      activeCall: active,
      lastError: null,
      lastTerminalReason: null,
      callStartedAtMs: Date.now(),
      callEstablishedAtMs: null,
      stats: { ...EMPTY_STATS },
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
        incomingCall: incomingFromActive(active),
        lastError: null,
        callStartedAtMs: active && s.callStartedAtMs == null ? Date.now() : s.callStartedAtMs,
        callEstablishedAtMs:
          active?.status === 'established'
            ? (s.callEstablishedAtMs ?? Date.now())
            : s.callEstablishedAtMs,
      }));
      return;
    }
    if (p.type === 'outgoing_pending' || p.type === 'outgoing') {
      const remote = typeof p.remote_identity === 'string' ? p.remote_identity.toLowerCase() : null;
      if (!remote) return;
      const linkId = typeof p.link_id === 'string' ? p.link_id : '';
      set((s) => {
        const sameRemote =
          s.activeCall?.role === 'outgoing' &&
          s.activeCall.remote_identity.toLowerCase() === remote;
        return {
          activeCall: {
            link_id: linkId || s.activeCall?.link_id || '',
            remote_identity: remote,
            role: 'outgoing',
            status: p.type === 'outgoing_pending' ? 'calling' : 'connecting',
            answered: false,
          },
          incomingCall: null,
          lastError: null,
          callStartedAtMs: sameRemote && s.callStartedAtMs != null ? s.callStartedAtMs : Date.now(),
          callEstablishedAtMs: sameRemote ? s.callEstablishedAtMs : null,
          stats: sameRemote ? s.stats : { ...EMPTY_STATS },
          callGeneration: sameRemote ? s.callGeneration : s.callGeneration + 1,
        };
      });
    }
  },

  applyStats: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Record<string, unknown>;
    set((s) => {
      const linkId = typeof p.link_id === 'string' ? p.link_id : null;
      if (
        linkId &&
        s.activeCall?.link_id &&
        s.activeCall.link_id.toLowerCase() !== linkId.toLowerCase()
      ) {
        return s;
      }
      const txFrames =
        typeof p.tx_frames === 'number' && Number.isFinite(p.tx_frames)
          ? Math.max(0, Math.floor(p.tx_frames))
          : s.stats.txFrames;
      const txPackets =
        typeof p.tx_packets === 'number' && Number.isFinite(p.tx_packets)
          ? Math.max(0, Math.floor(p.tx_packets))
          : s.stats.txPackets;
      const rxFrames =
        typeof p.rx_frames === 'number' && Number.isFinite(p.rx_frames)
          ? Math.max(0, Math.floor(p.rx_frames))
          : s.stats.rxFrames;
      return {
        stats: {
          ...s.stats,
          txFrames,
          txPackets,
          rxFrames,
        },
      };
    });
  },

  applyTerminated: (linkId, reason) => {
    set((s) => {
      if (!linkId?.trim()) {
        // Missing/empty link id — ignore (do not blind-clear the current call).
        return s;
      }
      if (s.activeCall?.link_id && s.activeCall.link_id.toLowerCase() !== linkId.toLowerCase()) {
        // Stale terminate for a previous call.
        return s;
      }
      return {
        ...resetSessionFields(),
        lastTerminalReason: reason ?? null,
      };
    });
  },

  applyError: (message) => {
    set({
      ...resetSessionFields(),
      lastError: message,
      lastTerminalReason: message,
    });
  },

  incrementLocalTxDrops: () => {
    set((s) => ({
      stats: { ...s.stats, localTxDrops: s.stats.localTxDrops + 1 },
    }));
  },

  setMicrophoneMuted: (muted) => {
    set({ microphoneMuted: muted });
  },

  clearCall: () => {
    set(resetSessionFields());
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
