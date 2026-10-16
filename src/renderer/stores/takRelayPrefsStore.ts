import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { isChannelIdentityKey } from '@/shared/channelIdentityKey';
import { TAK_GEOCHAT_ROOM_MAX_LEN } from '@/shared/tak-types';

import type { IdentityId } from '../lib/types';

/** Which of a radio's channels become ATAK contacts. */
export type TakChannelMode = 'off' | 'all' | 'selected';

const CHANNEL_MODES: readonly TakChannelMode[] = ['off', 'all', 'selected'];

/**
 * Settings saved by channel slot, from before they were kept by channel. They wait for the
 * radio's channel list and then go to the channel in each slot (see bindTakPendingSlots).
 */
export interface TakPendingSlotPrefs {
  chatChannels: number[];
  sendChannels: number[];
  remoteChannels: number[];
  atakNames: Record<number, string>;
}

/**
 * One radio's TAK settings. Settings for a channel are kept by its identity key, as its ATAK
 * contact is, so a different channel moving into its slot never inherits them.
 */
export interface TakRelayIdentityPrefs {
  /** Channel slots whose `!MT1` tracker fixes become TAK markers. */
  trackerChannels: number[];
  /** Which channels are served to ATAK as contacts. */
  channelMode: TakChannelMode;
  /** The channels served in `selected` mode, by channel key. */
  chatChannels: string[];
  /** Served channels TAK clients may send to, by channel key; the rest are receive only. */
  sendChannels: string[];
  /** Served channels also streamed, read only, to the remote TAK server, by channel key. */
  remoteChannels: string[];
  /**
   * Names the user chose for channels' ATAK contacts, by channel key. A channel without one
   * gets its automatic name.
   */
  atakNames: Record<string, string>;
  /** Settings from before the upgrade, by slot, until the radio's channels are known. */
  pendingSlots?: TakPendingSlotPrefs;
}

/**
 * Version 1's GeoChat room contacts, which no longer exist: their names, so main can tell ATAK
 * devices to drop them, until they would have gone stale there anyway.
 */
export interface TakRetiredRooms {
  rooms: string[];
  untilMs: number;
}

/** MeshCore channel slots are a single byte. */
const MAX_CHANNEL_INDEX = 255;
/** How long ATAK keeps a room contact that is no longer announced. */
const RETIRED_ROOM_TTL_MS = 24 * 60 * 60 * 1000;

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

function isChannelIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_CHANNEL_INDEX;
}

/** Valid channel slots from a stored list, sorted, without repeats. */
function slotList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isChannelIndex))].sort((a, b) => a - b);
}

/** Valid channel keys from a stored list, without repeats. */
function keyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isChannelIdentityKey))];
}

/** Valid names from a stored map, keeping the entries whose key `parseKey` accepts. */
function nameMap<K extends string | number>(
  raw: unknown,
  parseKey: (k: string) => K | null,
): Record<K, string> {
  const out = {} as Record<K, string>;
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = parseKey(k);
    const name = cleanAtakName(v);
    if (key !== null && name) out[key] = name;
  }
  return out;
}

const parseSlot = (k: string): number | null => {
  const n = Number(k);
  return isChannelIndex(n) ? n : null;
};
const parseChannelKey = (k: string): string | null => (isChannelIdentityKey(k) ? k : null);

function hasPending(p: TakPendingSlotPrefs): boolean {
  return (
    p.chatChannels.length > 0 ||
    p.sendChannels.length > 0 ||
    p.remoteChannels.length > 0 ||
    Object.keys(p.atakNames).length > 0
  );
}

/**
 * Version 1 kept a GeoChat room name per bridged channel slot and a send opt-in. Each bridged
 * channel becomes a selected channel that keeps its send setting, goes on streaming to the
 * remote server, where its room went before, and keeps its room name as its ATAK name, so the
 * remote server's room keeps its name too. All of it waits by slot for the channel list. Also
 * returns the rooms version 1 announced as contacts: those open for sending.
 */
function fromVersion1(v: Record<string, unknown>): {
  prefs: Omit<TakRelayIdentityPrefs, 'trackerChannels'>;
  contactRooms: string[];
} {
  const rooms = nameMap(v.chatBridges, parseSlot);
  const bridged = slotList(Object.keys(rooms).map(Number));
  const sending = slotList(v.chatSendChannels).filter((c) => bridged.includes(c));
  const pendingSlots: TakPendingSlotPrefs = {
    chatChannels: bridged,
    sendChannels: sending,
    remoteChannels: bridged,
    atakNames: rooms,
  };
  return {
    prefs: {
      ...EMPTY_PREFS,
      channelMode: bridged.length > 0 ? 'selected' : 'off',
      ...(hasPending(pendingSlots) ? { pendingSlots } : {}),
    },
    contactRooms: sending.map((c) => rooms[c]),
  };
}

/**
 * A radio's channel settings, whatever form they were saved in: lists of channel keys, or
 * lists of slots (an earlier build of this version), which wait as pending slots.
 */
function channelPrefs(
  v: Record<string, unknown>,
): Omit<TakRelayIdentityPrefs, 'trackerChannels' | 'channelMode'> {
  const stored =
    v.pendingSlots && typeof v.pendingSlots === 'object'
      ? (v.pendingSlots as Record<string, unknown>)
      : {};
  const slots = (field: string): number[] =>
    slotList([...slotList(stored[field]), ...slotList(v[field])]);
  const pendingSlots: TakPendingSlotPrefs = {
    chatChannels: slots('chatChannels'),
    sendChannels: slots('sendChannels'),
    remoteChannels: slots('remoteChannels'),
    atakNames: { ...nameMap(stored.atakNames, parseSlot), ...nameMap(v.atakNames, parseSlot) },
  };
  return {
    chatChannels: keyList(v.chatChannels),
    sendChannels: keyList(v.sendChannels),
    remoteChannels: keyList(v.remoteChannels),
    atakNames: nameMap(v.atakNames, parseChannelKey),
    ...(hasPending(pendingSlots) ? { pendingSlots } : {}),
  };
}

/**
 * Validate the stored preferences of every radio, reading every earlier shape, and collect the
 * rooms version 1 announced as contacts.
 */
function sanitizeStore(raw: unknown): {
  byIdentity: Record<IdentityId, TakRelayIdentityPrefs>;
  contactRooms: string[];
} {
  const byIdentity: Record<IdentityId, TakRelayIdentityPrefs> = {};
  const contactRooms = new Set<string>();
  if (!raw || typeof raw !== 'object') return { byIdentity, contactRooms: [] };
  for (const [identityId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const trackerChannels = slotList(v.trackerChannels);
    if (!('channelMode' in v)) {
      const fromV1 = fromVersion1(v);
      byIdentity[identityId] = { ...fromV1.prefs, trackerChannels };
      for (const room of fromV1.contactRooms) contactRooms.add(room);
      continue;
    }
    const channelMode = CHANNEL_MODES.includes(v.channelMode as TakChannelMode)
      ? (v.channelMode as TakChannelMode)
      : 'off';
    byIdentity[identityId] = { trackerChannels, channelMode, ...channelPrefs(v) };
  }
  return { byIdentity, contactRooms: [...contactRooms] };
}

/** Validate stored preferences, reading every earlier shape. */
export function sanitizePrefs(raw: unknown): Record<IdentityId, TakRelayIdentityPrefs> {
  return sanitizeStore(raw).byIdentity;
}

/** Valid retired rooms from storage, or none once they have expired. */
function sanitizeRetired(raw: unknown, nowMs: number): TakRetiredRooms | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.untilMs !== 'number' || r.untilMs <= nowMs || !Array.isArray(r.rooms)) return null;
  const rooms = [...new Set(r.rooms.map(cleanAtakName).filter((n): n is string => n !== null))];
  return rooms.length > 0 ? { rooms, untilMs: r.untilMs } : null;
}

type ChannelKeyList = 'chatChannels' | 'sendChannels' | 'remoteChannels';

interface TakRelayPrefsState {
  byIdentity: Record<IdentityId, TakRelayIdentityPrefs>;
  /** Version 1 room contacts for ATAK devices to drop; null when there are none. */
  retiredRooms: TakRetiredRooms | null;
  setTrackerChannel: (identityId: IdentityId, slot: number, enabled: boolean) => void;
  setChannelMode: (identityId: IdentityId, mode: TakChannelMode) => void;
  /** Serve one channel, by key, in `selected` mode. */
  setChatChannel: (identityId: IdentityId, key: string, enabled: boolean) => void;
  /** Let TAK clients send to a served channel; off, it is receive only. */
  setChatSend: (identityId: IdentityId, key: string, enabled: boolean) => void;
  /** Stream a served channel to the remote TAK server. */
  setChatRemote: (identityId: IdentityId, key: string, enabled: boolean) => void;
  /**
   * Name a channel's ATAK contact. A blank name goes back to the automatic one; one main would
   * refuse (too long, or with a line break) is ignored.
   */
  setAtakName: (identityId: IdentityId, key: string, name: string) => void;
}

export const useTakRelayPrefsStore = create<TakRelayPrefsState>()(
  persist(
    (set) => {
      const update = (
        identityId: IdentityId,
        change: (prev: TakRelayIdentityPrefs) => TakRelayIdentityPrefs | null,
      ): void => {
        set((s) => {
          const next = change(s.byIdentity[identityId] ?? EMPTY_PREFS);
          return next ? { byIdentity: { ...s.byIdentity, [identityId]: next } } : s;
        });
      };
      const toggle = (
        list: ChannelKeyList,
        identityId: IdentityId,
        key: string,
        enabled: boolean,
      ): void => {
        if (!isChannelIdentityKey(key)) return;
        update(identityId, (prev) => {
          if (prev[list].includes(key) === enabled) return null;
          const next = enabled ? [...prev[list], key] : prev[list].filter((k) => k !== key);
          return { ...prev, [list]: next };
        });
      };
      return {
        byIdentity: {},
        retiredRooms: null,
        setTrackerChannel: (identityId, slot, enabled) => {
          if (!isChannelIndex(slot)) return;
          update(identityId, (prev) => {
            if (prev.trackerChannels.includes(slot) === enabled) return null;
            const trackerChannels = enabled
              ? [...prev.trackerChannels, slot].sort((a, b) => a - b)
              : prev.trackerChannels.filter((c) => c !== slot);
            return { ...prev, trackerChannels };
          });
        },
        setChannelMode: (identityId, mode) => {
          if (!CHANNEL_MODES.includes(mode)) return;
          update(identityId, (prev) =>
            prev.channelMode === mode ? null : { ...prev, channelMode: mode },
          );
        },
        setChatChannel: (identityId, key, enabled) => {
          toggle('chatChannels', identityId, key, enabled);
        },
        setChatSend: (identityId, key, enabled) => {
          toggle('sendChannels', identityId, key, enabled);
        },
        setChatRemote: (identityId, key, enabled) => {
          toggle('remoteChannels', identityId, key, enabled);
        },
        setAtakName: (identityId, key, name) => {
          if (!isChannelIdentityKey(key)) return;
          const clean = cleanAtakName(name);
          if (clean === null && name.trim() !== '') return;
          update(identityId, (prev) => {
            if ((prev.atakNames[key] ?? null) === clean) return null;
            const atakNames = Object.fromEntries(
              Object.entries(prev.atakNames).filter(([k]) => k !== key),
            );
            if (clean !== null) atakNames[key] = clean;
            return { ...prev, atakNames };
          });
        },
      };
    },
    {
      name: 'mesh-client:takRelayPrefs',
      version: 3,
      partialize: (s) => ({ byIdentity: s.byIdentity, retiredRooms: s.retiredRooms }),
      // sanitizeStore reads every earlier shape, so the stored state passes through to merge.
      migrate: (persisted) => persisted,
      merge: (persisted, current) => {
        const p = persisted as { byIdentity?: unknown; retiredRooms?: unknown } | undefined;
        const now = Date.now();
        const { byIdentity, contactRooms } = sanitizeStore(p?.byIdentity);
        // Room contacts are retired once, when the version 1 settings are read.
        const retiredRooms =
          sanitizeRetired(p?.retiredRooms, now) ??
          (contactRooms.length > 0
            ? { rooms: contactRooms, untilMs: now + RETIRED_ROOM_TTL_MS }
            : null);
        return { ...current, byIdentity, retiredRooms };
      },
    },
  ),
);

export function getTakRelayPrefs(identityId: IdentityId): TakRelayIdentityPrefs {
  return useTakRelayPrefsStore.getState().byIdentity[identityId] ?? EMPTY_PREFS;
}

/**
 * Give settings saved by slot to the channels now in those slots, as the radio reports them. A
 * slot not in the list keeps its settings waiting, since a radio can report its channels a few
 * at a time; one that is bound never moves again.
 */
export function bindTakPendingSlots(
  identityId: IdentityId,
  channels: readonly { index: number; key: string }[],
): void {
  if (channels.length === 0) return;
  useTakRelayPrefsStore.setState((s) => {
    const prev = s.byIdentity[identityId] as TakRelayIdentityPrefs | undefined;
    const pending = prev?.pendingSlots;
    if (!prev || !pending) return s;
    const keyOf = new Map(channels.map((c) => [c.index, c.key]));
    const keys = (slots: number[]): string[] =>
      slots.map((slot) => keyOf.get(slot)).filter((k): k is string => k !== undefined);
    const names: Record<string, string> = {};
    for (const [slot, name] of Object.entries(pending.atakNames)) {
      const key = keyOf.get(Number(slot));
      if (key) names[key] = name;
    }
    const unbound = (slots: number[]): number[] => slots.filter((slot) => !keyOf.has(slot));
    if (
      keys(pending.chatChannels).length === 0 &&
      keys(pending.sendChannels).length === 0 &&
      keys(pending.remoteChannels).length === 0 &&
      Object.keys(names).length === 0
    ) {
      return s;
    }
    const left: TakPendingSlotPrefs = {
      chatChannels: unbound(pending.chatChannels),
      sendChannels: unbound(pending.sendChannels),
      remoteChannels: unbound(pending.remoteChannels),
      atakNames: Object.fromEntries(
        Object.entries(pending.atakNames).filter(([slot]) => !keyOf.has(Number(slot))),
      ),
    };
    const bound: TakRelayIdentityPrefs = {
      ...prev,
      chatChannels: [...new Set([...prev.chatChannels, ...keys(pending.chatChannels)])],
      sendChannels: [...new Set([...prev.sendChannels, ...keys(pending.sendChannels)])],
      remoteChannels: [...new Set([...prev.remoteChannels, ...keys(pending.remoteChannels)])],
      // A name the user set since the upgrade wins over the old room name.
      atakNames: { ...names, ...prev.atakNames },
      pendingSlots: left,
    };
    if (!hasPending(left)) delete bound.pendingSlots;
    return { byIdentity: { ...s.byIdentity, [identityId]: bound } };
  });
}

/** The version 1 room names ATAK devices should still drop; none once that has expired. */
export function getTakRetiredRooms(nowMs: number = Date.now()): string[] {
  const retired = useTakRelayPrefsStore.getState().retiredRooms;
  return retired && retired.untilMs > nowMs ? retired.rooms : [];
}
