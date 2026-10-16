import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { TAK_GEOCHAT_ROOM_MAX_LEN } from '@/shared/tak-types';

import type { IdentityId } from '../lib/types';

/** Which of a radio's channels become ATAK contacts. */
export type TakChannelMode = 'off' | 'all' | 'selected';

const CHANNEL_MODES: readonly TakChannelMode[] = ['off', 'all', 'selected'];

/** Channel indices are device-specific, so relay preferences are kept per identity. */
export interface TakRelayIdentityPrefs {
  /** Channels whose `!MT1` tracker fixes become TAK markers. */
  trackerChannels: number[];
  /** Which channels are served to ATAK as contacts. */
  channelMode: TakChannelMode;
  /** The channels served in `selected` mode. */
  chatChannels: number[];
  /** Served channels TAK clients may send to; the rest are receive only. */
  sendChannels: number[];
  /** Served channels also streamed, read only, to the remote TAK server. */
  remoteChannels: number[];
  /**
   * Names the user chose for channels' ATAK contacts, by channel index. A channel without one
   * gets its automatic name.
   */
  atakNames: Record<number, string>;
}

/** MeshCore channel slots are a single byte. */
const MAX_CHANNEL_INDEX = 255;

const EMPTY_PREFS: TakRelayIdentityPrefs = {
  trackerChannels: [],
  channelMode: 'off',
  chatChannels: [],
  sendChannels: [],
  remoteChannels: [],
  atakNames: {},
};

const CONTROL_CHARS_RE = /\p{Cc}/u;

/**
 * A usable ATAK contact name: trimmed, one line, 1 to {@link TAK_GEOCHAT_ROOM_MAX_LEN} UTF-16
 * units (what main accepts); null otherwise.
 */
export function cleanAtakName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name || name.length > TAK_GEOCHAT_ROOM_MAX_LEN || CONTROL_CHARS_RE.test(name)) return null;
  return name;
}

/** Valid custom names from a stored map, by channel index. */
function atakNameMap(raw: unknown): Record<number, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const index = Number(k);
    const name = cleanAtakName(v);
    if (isChannelIndex(index) && name) out[index] = name;
  }
  return out;
}

function isChannelIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_CHANNEL_INDEX;
}

/** Valid channel indices from a stored list, sorted, without repeats. */
function channelList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isChannelIndex))].sort((a, b) => a - b);
}

/**
 * Version 1 kept a GeoChat room name per bridged channel and a send opt-in. Each bridged
 * channel becomes a selected channel that keeps its send setting and goes on streaming to the
 * remote server, where its room went before; the room names are dropped, since names now come
 * from the channel.
 */
function fromVersion1(
  v: Record<string, unknown>,
): Omit<TakRelayIdentityPrefs, 'trackerChannels' | 'atakNames'> {
  const bridged =
    v.chatBridges && typeof v.chatBridges === 'object'
      ? channelList(
          Object.entries(v.chatBridges as Record<string, unknown>)
            .filter(([, room]) => typeof room === 'string' && room.trim() !== '')
            .map(([k]) => Number(k)),
        )
      : [];
  const sending = channelList(v.chatSendChannels).filter((c) => bridged.includes(c));
  return {
    channelMode: bridged.length > 0 ? 'selected' : 'off',
    chatChannels: bridged,
    sendChannels: sending,
    remoteChannels: bridged,
  };
}

/** Validate stored preferences, reading the version 1 shape too. */
export function sanitizePrefs(raw: unknown): Record<IdentityId, TakRelayIdentityPrefs> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<IdentityId, TakRelayIdentityPrefs> = {};
  for (const [identityId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const trackerChannels = channelList(v.trackerChannels);
    if (!('channelMode' in v)) {
      out[identityId] = { trackerChannels, ...fromVersion1(v), atakNames: {} };
      continue;
    }
    const channelMode = CHANNEL_MODES.includes(v.channelMode as TakChannelMode)
      ? (v.channelMode as TakChannelMode)
      : 'off';
    out[identityId] = {
      trackerChannels,
      channelMode,
      chatChannels: channelList(v.chatChannels),
      sendChannels: channelList(v.sendChannels),
      remoteChannels: channelList(v.remoteChannels),
      atakNames: atakNameMap(v.atakNames),
    };
  }
  return out;
}

type ChannelListKey = 'trackerChannels' | 'chatChannels' | 'sendChannels' | 'remoteChannels';

interface TakRelayPrefsState {
  byIdentity: Record<IdentityId, TakRelayIdentityPrefs>;
  setTrackerChannel: (identityId: IdentityId, channel: number, enabled: boolean) => void;
  setChannelMode: (identityId: IdentityId, mode: TakChannelMode) => void;
  /** Serve one channel in `selected` mode. */
  setChatChannel: (identityId: IdentityId, channel: number, enabled: boolean) => void;
  /** Let TAK clients send to a served channel; off, it is receive only. */
  setChatSend: (identityId: IdentityId, channel: number, enabled: boolean) => void;
  /** Stream a served channel to the remote TAK server. */
  setChatRemote: (identityId: IdentityId, channel: number, enabled: boolean) => void;
  /**
   * Name a channel's ATAK contact. A blank name goes back to the automatic one; one main would
   * refuse (too long, or with a line break) is ignored.
   */
  setAtakName: (identityId: IdentityId, channel: number, name: string) => void;
}

export const useTakRelayPrefsStore = create<TakRelayPrefsState>()(
  persist(
    (set) => {
      const toggle = (
        key: ChannelListKey,
        identityId: IdentityId,
        channel: number,
        enabled: boolean,
      ): void => {
        if (!isChannelIndex(channel)) return;
        set((s) => {
          const prev = s.byIdentity[identityId] ?? EMPTY_PREFS;
          if (prev[key].includes(channel) === enabled) return s;
          const list = enabled
            ? [...prev[key], channel].sort((a, b) => a - b)
            : prev[key].filter((c) => c !== channel);
          return { byIdentity: { ...s.byIdentity, [identityId]: { ...prev, [key]: list } } };
        });
      };
      return {
        byIdentity: {},
        setTrackerChannel: (identityId, channel, enabled) => {
          toggle('trackerChannels', identityId, channel, enabled);
        },
        setChannelMode: (identityId, mode) => {
          if (!CHANNEL_MODES.includes(mode)) return;
          set((s) => {
            const prev = s.byIdentity[identityId] ?? EMPTY_PREFS;
            if (prev.channelMode === mode) return s;
            return {
              byIdentity: { ...s.byIdentity, [identityId]: { ...prev, channelMode: mode } },
            };
          });
        },
        setChatChannel: (identityId, channel, enabled) => {
          toggle('chatChannels', identityId, channel, enabled);
        },
        setChatSend: (identityId, channel, enabled) => {
          toggle('sendChannels', identityId, channel, enabled);
        },
        setChatRemote: (identityId, channel, enabled) => {
          toggle('remoteChannels', identityId, channel, enabled);
        },
        setAtakName: (identityId, channel, name) => {
          if (!isChannelIndex(channel)) return;
          const clean = cleanAtakName(name);
          if (clean === null && name.trim() !== '') return;
          set((s) => {
            const prev = s.byIdentity[identityId] ?? EMPTY_PREFS;
            if ((prev.atakNames[channel] ?? null) === clean) return s;
            const atakNames = Object.fromEntries(
              Object.entries(prev.atakNames).filter(([k]) => Number(k) !== channel),
            ) as Record<number, string>;
            if (clean !== null) atakNames[channel] = clean;
            return { byIdentity: { ...s.byIdentity, [identityId]: { ...prev, atakNames } } };
          });
        },
      };
    },
    {
      name: 'mesh-client:takRelayPrefs',
      version: 2,
      partialize: (s) => ({ byIdentity: s.byIdentity }),
      // sanitizePrefs reads both shapes, so a version 1 store passes through to merge as is.
      migrate: (persisted) => persisted,
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
