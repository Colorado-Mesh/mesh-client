import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { TAK_GEOCHAT_ROOM_MAX_LEN } from '@/shared/tak-types';

import type { IdentityId } from '../lib/types';

/** Channel indices are device-specific, so relay preferences are kept per identity. */
export interface TakRelayIdentityPrefs {
  /** Channels whose `!MT1` tracker fixes become TAK markers. */
  trackerChannels: number[];
  /** Channel index to the TAK GeoChat room its messages are mirrored into. */
  chatBridges: Record<number, string>;
}

/** MeshCore channel slots are a single byte. */
const MAX_CHANNEL_INDEX = 255;

const EMPTY_PREFS: TakRelayIdentityPrefs = { trackerChannels: [], chatBridges: {} };

function isChannelIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_CHANNEL_INDEX;
}

function sanitizePrefs(raw: unknown): Record<IdentityId, TakRelayIdentityPrefs> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<IdentityId, TakRelayIdentityPrefs> = {};
  for (const [identityId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const trackerChannels = Array.isArray(v.trackerChannels)
      ? [...new Set(v.trackerChannels.filter(isChannelIndex))]
      : [];
    const chatBridges: Record<number, string> = {};
    if (v.chatBridges && typeof v.chatBridges === 'object') {
      for (const [k, room] of Object.entries(v.chatBridges as Record<string, unknown>)) {
        const idx = Number(k);
        if (!isChannelIndex(idx) || typeof room !== 'string') continue;
        const trimmed = room.trim().slice(0, TAK_GEOCHAT_ROOM_MAX_LEN);
        if (trimmed) chatBridges[idx] = trimmed;
      }
    }
    out[identityId] = { trackerChannels, chatBridges };
  }
  return out;
}

interface TakRelayPrefsState {
  byIdentity: Record<IdentityId, TakRelayIdentityPrefs>;
  setTrackerChannel: (identityId: IdentityId, channel: number, enabled: boolean) => void;
  /** Empty room removes the bridge. */
  setChatBridge: (identityId: IdentityId, channel: number, room: string) => void;
}

export const useTakRelayPrefsStore = create<TakRelayPrefsState>()(
  persist(
    (set) => ({
      byIdentity: {},
      setTrackerChannel: (identityId, channel, enabled) => {
        if (!isChannelIndex(channel)) return;
        set((s) => {
          const prev = s.byIdentity[identityId] ?? EMPTY_PREFS;
          const has = prev.trackerChannels.includes(channel);
          if (has === enabled) return s;
          const trackerChannels = enabled
            ? [...prev.trackerChannels, channel].sort((a, b) => a - b)
            : prev.trackerChannels.filter((c) => c !== channel);
          return { byIdentity: { ...s.byIdentity, [identityId]: { ...prev, trackerChannels } } };
        });
      },
      setChatBridge: (identityId, channel, room) => {
        if (!isChannelIndex(channel)) return;
        set((s) => {
          const prev = s.byIdentity[identityId] ?? EMPTY_PREFS;
          const trimmed = room.trim().slice(0, TAK_GEOCHAT_ROOM_MAX_LEN);
          const chatBridges = Object.fromEntries(
            Object.entries(prev.chatBridges).filter(([key]) => Number(key) !== channel),
          ) as Record<number, string>;
          if (trimmed) chatBridges[channel] = trimmed;
          return { byIdentity: { ...s.byIdentity, [identityId]: { ...prev, chatBridges } } };
        });
      },
    }),
    {
      name: 'mesh-client:takRelayPrefs',
      version: 1,
      partialize: (s) => ({ byIdentity: s.byIdentity }),
      merge: (persisted, current) => ({
        ...current,
        byIdentity: sanitizePrefs((persisted as { byIdentity?: unknown } | undefined)?.byIdentity),
      }),
    },
  ),
);

export function getTakRelayPrefs(identityId: IdentityId): TakRelayIdentityPrefs {
  return useTakRelayPrefsStore.getState().byIdentity[identityId] ?? EMPTY_PREFS;
}
