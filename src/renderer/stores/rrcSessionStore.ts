import { create } from 'zustand';

import {
  isRrcWhisperPeerHash,
  parseRrcDmRoomKey,
  type RrcDmPeer,
  rrcDmRoomKey,
} from '@/renderer/lib/rrcDmRoom';
import { persistRrcMessage } from '@/renderer/lib/rrcMessagePersist';
import { removeRrcOpenDm, upsertRrcOpenDm } from '@/renderer/lib/rrcOpenDms';
import { clearHydratedRrcRoomKeysForHub } from '@/renderer/lib/rrcRoomHistoryHydration';
import {
  coalesceRrcMemberRoster,
  dedupeRrcMembers,
  rrcIdentityHashesMatch,
} from '@/renderer/lib/rrcRoomMembers';
import { rrcRoomMatchKey, rrcRoomsMatch } from '@/renderer/lib/rrcRoomName';
import {
  MAX_RRC_MEMBERS_PER_ROOM,
  MAX_RRC_ROOMS_PER_HUB,
  RRC_ROOM_HISTORY_LOAD_COUNT,
} from '@/renderer/lib/sessionMemoryCaps';
import type {
  RrcChatMessage,
  RrcHubCapabilities,
  RrcListedRoom,
  RrcRoomInfo,
  RrcRoomMember,
  RrcSessionStatus,
} from '@/shared/rrc-types';

const MAX_MESSAGES_PER_ROOM = RRC_ROOM_HISTORY_LOAD_COUNT;
const MAX_ROOMS_PER_HUB = MAX_RRC_ROOMS_PER_HUB;
const MAX_MEMBERS_PER_ROOM = MAX_RRC_MEMBERS_PER_ROOM;

/** Soft cap on simultaneous connected hub sessions — mirrors sidecar `MAX_HUB_SESSIONS`. */
export const MAX_RRC_HUB_SESSIONS = 8;

/** Synthetic room key for hub-scoped NOTICE/ERROR with no K_ROOM. */
export const RRC_HUB_STREAM_ROOM = '[hub]';

/**
 * @deprecated Legacy single-inbox key — use `@<hash>` via `rrcDmRoomKey`.
 * Kept for migration / old tests.
 */
export const RRC_WHISPERS_ROOM = '[whispers]';

/** @deprecated Prefer `RrcDmPeer` from `rrcDmRoom`. */
export type RrcWhisperPeer = RrcDmPeer;

function normRoom(room: string): string {
  return room.trim().toLowerCase();
}

function normHub(hub: string | null | undefined): string | null {
  if (!hub) return null;
  const h = hub.trim().toLowerCase();
  return h || null;
}

/** Evict oldest room entries when a hub exceeds the soft room cap. */
function trimRoomMap(rooms: Map<string, RrcRoomInfo>): Map<string, RrcRoomInfo> {
  if (rooms.size <= MAX_ROOMS_PER_HUB) return rooms;
  const next = new Map(rooms);
  const overflow = next.size - MAX_ROOMS_PER_HUB;
  let dropped = 0;
  for (const key of next.keys()) {
    if (dropped >= overflow) break;
    if (key.startsWith('[') || key.startsWith('@')) continue; // keep synthetic streams / DMs
    next.delete(key);
    dropped += 1;
  }
  return next;
}

/**
 * Soft storage key for messages/unread so `#lobby` and `lobby` share one bucket.
 * Synthetic rooms keep their exact spelling.
 */
function roomStorageKey(room: string): string {
  return rrcRoomMatchKey(room) || normRoom(room);
}

function msgKey(hub: string, room: string): string {
  return `${hub}::${roomStorageKey(room)}`;
}

/**
 * Coalesce `#name` / `name` onto one map entry.
 * Keep the first already-joined key so PART uses the same spelling as JOIN.
 */
function coalesceRoomAliases(
  rooms: Map<string, RrcRoomInfo>,
  incomingRoom: string,
): { key: string; existing: RrcRoomInfo | undefined; rooms: Map<string, RrcRoomInfo> } {
  const incomingKey = normRoom(incomingRoom);
  const existingKeys = [...rooms.keys()].filter((k) => rrcRoomsMatch(k, incomingKey));
  const key = existingKeys[0] ?? incomingKey;
  const aliases = [...existingKeys];
  if (!aliases.includes(incomingKey)) aliases.push(incomingKey);
  let existing: RrcRoomInfo | undefined;
  const next = new Map(rooms);
  for (const alias of aliases) {
    const info = next.get(alias);
    if (!info) continue;
    if (!existing) {
      existing = info;
    } else {
      const union = dedupeRrcMembers([...(existing.members ?? []), ...(info.members ?? [])]);
      existing = {
        name: existing.name ?? info.name,
        members: union,
        member_count: union.length,
        topic: existing.topic ?? info.topic ?? null,
      };
    }
    if (alias !== key) next.delete(alias);
  }
  return { key, existing, rooms: next };
}

/** Per-hub RRC session state, keyed by lowercase hub destination hash in `sessionsByHub`. */
export interface RrcHubSessionState {
  status: RrcSessionStatus;
  hubName: string | null;
  capabilities: RrcHubCapabilities;
  rooms: Map<string, RrcRoomInfo>;
  listedRooms: RrcListedRoom[];
  activeRoom: string | null;
  lastError: string | null;
  /** Sticky moderation / remote-takedown banner. */
  moderationBanner: string | null;
  unreadByRoom: Map<string, number>;
  /** True while a local PART is in flight (voluntary leave). */
  partIntentRooms: Set<string>;
  /** True when user requested disconnect (not hub drop). */
  disconnectIntent: boolean;
}

export function emptyHubSession(): RrcHubSessionState {
  return {
    status: 'disconnected',
    hubName: null,
    capabilities: {},
    rooms: new Map(),
    listedRooms: [],
    activeRoom: null,
    lastError: null,
    moderationBanner: null,
    unreadByRoom: new Map(),
    partIntentRooms: new Set(),
    disconnectIntent: false,
  };
}

/** Mirror the focused hub's per-hub fields onto the store's top-level compat fields. */
function mirrorFromSession(
  hub: string | null,
  session: RrcHubSessionState,
): Pick<
  RrcSessionStoreState,
  | 'hubDestHash'
  | 'status'
  | 'hubName'
  | 'capabilities'
  | 'rooms'
  | 'listedRooms'
  | 'activeRoom'
  | 'lastError'
  | 'moderationBanner'
  | 'unreadByRoom'
  | 'partIntentRooms'
  | 'disconnectIntent'
> {
  return {
    hubDestHash: hub,
    status: session.status,
    hubName: session.hubName,
    capabilities: session.capabilities,
    rooms: session.rooms,
    listedRooms: session.listedRooms,
    activeRoom: session.activeRoom,
    lastError: session.lastError,
    moderationBanner: session.moderationBanner,
    unreadByRoom: session.unreadByRoom,
    partIntentRooms: session.partIntentRooms,
    disconnectIntent: session.disconnectIntent,
  };
}

/**
 * Apply `updater` to the resolved hub's session (explicit `hubHash`, else the focused hub) and
 * refresh the top-level mirror fields when that hub is the focused one. No-ops when neither an
 * explicit hub nor a focused hub is available.
 */
function mutateHubSession(
  s: RrcSessionStoreState,
  hubHash: string | undefined,
  updater: (session: RrcHubSessionState) => RrcHubSessionState,
): Partial<RrcSessionStoreState> {
  const hub = hubHash !== undefined ? normHub(hubHash) : s.focusedHubHash;
  if (!hub) return {};
  const existing = s.sessionsByHub.get(hub) ?? emptyHubSession();
  const nextSession = updater(existing);
  const sessionsByHub = new Map(s.sessionsByHub);
  sessionsByHub.set(hub, nextSession);
  const mirror = hub === s.focusedHubHash ? mirrorFromSession(hub, nextSession) : {};
  return { sessionsByHub, ...mirror };
}

/**
 * Tear down one hub's session: stash its live unread onto `unreadByHub`, drop its rooms/messages,
 * and — when it was focused — refocus another connected hub (or `null`) and refresh mirrors.
 * Shared by `applyStatus('disconnected', hub)` and `clearHubSession(hub)`.
 */
function removeHubSession(s: RrcSessionStoreState, hub: string): Partial<RrcSessionStoreState> {
  const session = s.sessionsByHub.get(hub);
  const sessionsByHub = new Map(s.sessionsByHub);
  sessionsByHub.delete(hub);

  const unreadByHub = new Map(s.unreadByHub);
  if (session) {
    let roomTotal = 0;
    for (const v of session.unreadByRoom.values()) roomTotal += v;
    if (roomTotal > 0) {
      unreadByHub.set(hub, Math.max(unreadByHub.get(hub) ?? 0, roomTotal));
    }
  }

  const messages = new Map(s.messages);
  const prefix = `${hub}::`;
  for (const key of [...messages.keys()]) {
    if (key.startsWith(prefix)) messages.delete(key);
  }

  if (s.focusedHubHash !== hub) {
    return { sessionsByHub, unreadByHub, messages };
  }
  const nextFocused = [...sessionsByHub.keys()][0] ?? null;
  const nextSession = nextFocused
    ? (sessionsByHub.get(nextFocused) ?? emptyHubSession())
    : emptyHubSession();
  return {
    sessionsByHub,
    unreadByHub,
    messages,
    focusedHubHash: nextFocused,
    ...mirrorFromSession(nextFocused, nextSession),
  };
}

interface RrcSessionStoreState {
  /** All tracked hub sessions, keyed by lowercase hub destination hash. */
  sessionsByHub: Map<string, RrcHubSessionState>;
  /** Hub currently shown in the main pane; drives the mirror fields below. */
  focusedHubHash: string | null;
  nickname: string;
  /** Local Reticulum identity hash (hex) for self-echo unread suppression. */
  localIdentityHash: string | null;
  /** Live + hydrated messages keyed by `${hub}::${room}`, shared across all hub sessions. */
  messages: Map<string, RrcChatMessage[]>;
  /** Per-hub unread totals stashed when a hub session is removed (survives disconnect). */
  unreadByHub: Map<string, number>;
  showTimestamps: boolean;

  // ── Mirror fields: always reflect `sessionsByHub.get(focusedHubHash)`. ──
  status: RrcSessionStatus;
  hubDestHash: string | null;
  hubName: string | null;
  capabilities: RrcHubCapabilities;
  rooms: Map<string, RrcRoomInfo>;
  listedRooms: RrcListedRoom[];
  activeRoom: string | null;
  lastError: string | null;
  moderationBanner: string | null;
  unreadByRoom: Map<string, number>;
  partIntentRooms: Set<string>;
  disconnectIntent: boolean;

  /** Focus a hub in the main pane. Never disconnects or wipes other hubs. */
  setFocusedHub: (hash: string | null) => void;
  setNickname: (nick: string) => void;
  setLocalIdentityHash: (hash: string | null) => void;
  setActiveRoom: (room: string | null, hubHash?: string) => void;
  setShowTimestamps: (show: boolean) => void;
  setCapabilities: (caps: RrcHubCapabilities, hubHash?: string) => void;
  setListedRooms: (rooms: RrcListedRoom[], hubHash?: string) => void;
  setRoomTopic: (room: string, topic: string | null, hubHash?: string) => void;
  mergeRoomMembers: (
    room: string,
    members: RrcRoomMember[],
    mode: 'replace' | 'merge',
    hubHash?: string,
  ) => void;
  markPartIntent: (room: string, hubHash?: string) => void;
  clearPartIntent: (room: string, hubHash?: string) => void;
  setDisconnectIntent: (intent: boolean, hubHash?: string) => void;
  setModerationBanner: (message: string | null, hubHash?: string) => void;
  /**
   * Open a client-local per-peer DM (`@hash`) — no hub JOIN.
   * Persists to localStorage so the DM survives restart until `closeDm`.
   */
  openDm: (peer: RrcDmPeer, hubHash?: string, opts?: { focus?: boolean }) => void;
  /**
   * Close a client-local DM: remove from JOINED + open-DM prefs.
   * Keeps SQLite / in-memory message history unless Clear history is used.
   */
  closeDm: (roomOrHash: string, hubHash?: string) => void;
  /** Update one hub's session (creating it if new). Never wipes sibling hubs. */
  applyStatus: (
    status: RrcSessionStatus,
    hubDestHash?: string | null,
    hubName?: string | null,
  ) => void;
  setError: (message: string | null, hubHash?: string) => void;
  roomJoined: (room: string, members?: RrcRoomMember[], hubHash?: string) => void;
  /**
   * Remove room membership. When `forced`, treat as remote takedown and keep
   * a system trail (caller should set moderationBanner).
   */
  roomParted: (room: string, opts?: { forced?: boolean }, hubHash?: string) => void;
  addMessage: (msg: RrcChatMessage, opts?: { bumpUnread?: boolean; hubDestHash?: string }) => void;
  /**
   * Merge SQLite history ahead of live messages (dedup by id). Does not re-persist.
   */
  mergeHistoryMessages: (hubHash: string, room: string, history: RrcChatMessage[]) => void;
  /** Clear in-memory messages for one hub room (DB clear is a separate IPC call). */
  clearRoomMessages: (hubHash: string, room: string) => void;
  clearUnread: (room: string, hubHash?: string) => void;
  clearActiveRoomMessages: (hubHash?: string) => void;
  /** Tear down every tracked hub (stack teardown). */
  clearSession: () => void;
  /** Tear down one hub after a local disconnect. */
  clearHubSession: (hubHash: string) => void;
  /** Sum of live unread across every session, plus stashed unread for removed hubs. */
  totalUnread: () => number;
  unreadForHub: (hubHash: string) => number;
  messagesForActiveRoom: () => RrcChatMessage[];
  roomMessageKey: (room: string, hubHash?: string) => string | null;
}

export const RRC_NICKNAME_STORAGE_KEY = 'mesh-client:rrcNickname';

function loadInitialRrcNickname(): string {
  try {
    const nick = localStorage.getItem(RRC_NICKNAME_STORAGE_KEY)?.trim();
    if (nick) return nick;
  } catch {
    // catch-no-log-ok localStorage may be unavailable (tests / SSR)
  }
  return 'mesh-client';
}

export const useRrcSessionStore = create<RrcSessionStoreState>((set, get) => ({
  sessionsByHub: new Map(),
  focusedHubHash: null,
  nickname: loadInitialRrcNickname(),
  localIdentityHash: null,
  messages: new Map(),
  unreadByHub: new Map(),
  showTimestamps: false,

  status: 'disconnected',
  hubDestHash: null,
  hubName: null,
  capabilities: {},
  rooms: new Map(),
  listedRooms: [],
  activeRoom: null,
  lastError: null,
  moderationBanner: null,
  unreadByRoom: new Map(),
  partIntentRooms: new Set(),
  disconnectIntent: false,

  setFocusedHub: (hash) => {
    const hub = normHub(hash);
    set((s) => {
      const session = hub ? (s.sessionsByHub.get(hub) ?? emptyHubSession()) : emptyHubSession();
      return { focusedHubHash: hub, ...mirrorFromSession(hub, session) };
    });
  },

  setNickname: (nick) => {
    set({ nickname: nick.trim() || 'mesh-client' });
  },

  setLocalIdentityHash: (hash) => {
    set({ localIdentityHash: hash ? hash.trim().toLowerCase() : null });
  },

  setActiveRoom: (room, hubHash) => {
    set((s) =>
      mutateHubSession(s, hubHash, (session) => {
        if (!room) return { ...session, activeRoom: null };
        const soft = [...session.rooms.keys()].find((k) => rrcRoomsMatch(k, room));
        const key = soft ?? normRoom(room);
        const unreadByRoom = new Map(session.unreadByRoom);
        for (const [rk] of session.unreadByRoom) {
          if (rrcRoomsMatch(rk, key)) unreadByRoom.delete(rk);
        }
        return { ...session, activeRoom: key, unreadByRoom };
      }),
    );
  },

  setShowTimestamps: (show) => {
    set({ showTimestamps: show });
  },

  setCapabilities: (caps, hubHash) => {
    set((s) => mutateHubSession(s, hubHash, (session) => ({ ...session, capabilities: caps })));
  },

  setListedRooms: (rooms, hubHash) => {
    set((s) => mutateHubSession(s, hubHash, (session) => ({ ...session, listedRooms: rooms })));
  },

  setRoomTopic: (room, topic, hubHash) => {
    set((s) =>
      mutateHubSession(s, hubHash, (session) => {
        const { key, existing, rooms } = coalesceRoomAliases(session.rooms, room);
        if (existing || rooms.has(key)) {
          const cur = rooms.get(key) ?? existing;
          rooms.set(key, {
            name: cur?.name ?? room,
            members: cur?.members,
            member_count: cur?.member_count,
            topic: topic || null,
          });
        }
        const listedRooms = session.listedRooms.map((r) =>
          rrcRoomsMatch(r.name, room) ? { ...r, topic: topic || undefined } : r,
        );
        return { ...session, rooms, listedRooms };
      }),
    );
  },

  mergeRoomMembers: (room, members, mode, hubHash) => {
    set((s) =>
      mutateHubSession(s, hubHash, (session) => {
        const { key, existing, rooms } = coalesceRoomAliases(session.rooms, room);
        let nextMembers: RrcRoomMember[];
        if (mode === 'merge') {
          const prior = existing?.members ?? [];
          if (prior.length === 0) {
            nextMembers = coalesceRrcMemberRoster(members, undefined);
          } else {
            const byHash = new Map<string, RrcRoomMember>();
            for (const m of prior) {
              byHash.set(m.identity_hash.toLowerCase(), m);
            }
            for (const m of members) {
              const prev = [...byHash.values()].find(
                (p) =>
                  rrcIdentityHashesMatch(p.identity_hash, m.identity_hash) ||
                  (Boolean(m.nickname?.trim()) &&
                    Boolean(p.nickname?.trim()) &&
                    m.nickname!.trim().toLowerCase() === p.nickname!.trim().toLowerCase()),
              );
              if (prev) {
                byHash.delete(prev.identity_hash.toLowerCase());
                const [upgraded] = coalesceRrcMemberRoster([m], [prev]);
                if (upgraded) byHash.set(upgraded.identity_hash.toLowerCase(), upgraded);
              } else {
                byHash.set(m.identity_hash.toLowerCase(), {
                  identity_hash: m.identity_hash.toLowerCase(),
                  nickname: m.nickname ?? null,
                });
              }
            }
            nextMembers = [...byHash.values()];
          }
        } else if (members.length === 0 && (existing?.members?.length ?? 0) > 0) {
          // Empty `/who` (or parse miss) must not wipe a known roster.
          nextMembers = existing!.members!;
        } else {
          // Authoritative `/who` snapshot: drop peers absent from the notice so
          // departed nicks disappear. Truncated notices should use merge mode.
          nextMembers = coalesceRrcMemberRoster(members, existing?.members, {
            keepUnmatchedExisting: false,
          });
        }
        rooms.set(key, {
          name: existing?.name ?? room,
          topic: existing?.topic,
          members: nextMembers.slice(0, MAX_MEMBERS_PER_ROOM),
          member_count: Math.min(nextMembers.length, MAX_MEMBERS_PER_ROOM),
        });
        return { ...session, rooms: trimRoomMap(rooms) };
      }),
    );
  },

  markPartIntent: (room, hubHash) => {
    const key = rrcRoomMatchKey(room) || normRoom(room);
    set((s) =>
      mutateHubSession(s, hubHash, (session) => {
        const partIntentRooms = new Set(session.partIntentRooms);
        partIntentRooms.add(key);
        return { ...session, partIntentRooms };
      }),
    );
  },

  clearPartIntent: (room, hubHash) => {
    set((s) =>
      mutateHubSession(s, hubHash, (session) => {
        const partIntentRooms = new Set(session.partIntentRooms);
        for (const k of [...partIntentRooms]) {
          if (rrcRoomsMatch(k, room)) partIntentRooms.delete(k);
        }
        return { ...session, partIntentRooms };
      }),
    );
  },

  setDisconnectIntent: (intent, hubHash) => {
    set((s) =>
      mutateHubSession(s, hubHash, (session) => ({ ...session, disconnectIntent: intent })),
    );
  },

  setModerationBanner: (message, hubHash) => {
    set((s) =>
      mutateHubSession(s, hubHash, (session) => ({ ...session, moderationBanner: message })),
    );
  },

  openDm: (peer, hubHash, opts) => {
    const hash = peer.identity_hash.trim().toLowerCase();
    if (!isRrcWhisperPeerHash(hash)) return;
    const room = rrcDmRoomKey(hash);
    const nick = peer.nickname?.trim() ? peer.nickname.trim() : null;
    set((s) => {
      const hub = hubHash !== undefined ? normHub(hubHash) : s.focusedHubHash;
      if (!hub) return {};
      upsertRrcOpenDm(hub, { identity_hash: hash, nickname: nick });
      return mutateHubSession(s, hub, (session) => {
        const rooms = new Map(session.rooms);
        const existing = rooms.get(room);
        const prevMember = existing?.members?.[0];
        const nextNick = nick ?? prevMember?.nickname ?? null;
        rooms.set(room, {
          name: room,
          members: [{ identity_hash: hash, nickname: nextNick }],
          member_count: 1,
          topic: existing?.topic ?? null,
        });
        const focus = opts?.focus !== false;
        return {
          ...session,
          rooms: trimRoomMap(rooms),
          activeRoom: focus ? room : session.activeRoom,
        };
      });
    });
  },

  closeDm: (roomOrHash, hubHash) => {
    const parsed = parseRrcDmRoomKey(roomOrHash);
    const hash =
      parsed ?? (isRrcWhisperPeerHash(roomOrHash) ? roomOrHash.trim().toLowerCase() : null);
    if (!hash) return;
    const room = rrcDmRoomKey(hash);
    set((s) => {
      const hub = hubHash !== undefined ? normHub(hubHash) : s.focusedHubHash;
      if (!hub) return {};
      removeRrcOpenDm(hub, hash);
      return mutateHubSession(s, hub, (session) => {
        const rooms = new Map(session.rooms);
        rooms.delete(room);
        const unreadByRoom = new Map(session.unreadByRoom);
        for (const [rk] of session.unreadByRoom) {
          if (rrcRoomsMatch(rk, room)) unreadByRoom.delete(rk);
        }
        const activeGone = session.activeRoom != null && rrcRoomsMatch(session.activeRoom, room);
        let nextActive = activeGone ? null : session.activeRoom;
        if (activeGone) {
          // Prefer another real room, else another open DM, else null.
          for (const name of rooms.keys()) {
            if (!name.startsWith('[')) {
              nextActive = name;
              break;
            }
          }
        }
        return {
          ...session,
          rooms,
          unreadByRoom,
          activeRoom: nextActive,
        };
      });
    });
  },

  applyStatus: (status, hubDestHash, hubName) => {
    set((s) => {
      const targetHub = hubDestHash !== undefined ? normHub(hubDestHash) : s.focusedHubHash;
      if (!targetHub) return {};
      if (status === 'disconnected') {
        return removeHubSession(s, targetHub);
      }
      const isNewSession = !s.sessionsByHub.has(targetHub);
      const existing = s.sessionsByHub.get(targetHub) ?? emptyHubSession();
      const nextSession: RrcHubSessionState = {
        ...existing,
        status,
        hubName: hubName !== undefined ? hubName : existing.hubName,
      };
      const sessionsByHub = new Map(s.sessionsByHub);
      sessionsByHub.set(targetHub, nextSession);

      // A fresh session should not inherit a stale badge count stashed from a prior connection.
      let unreadByHub = s.unreadByHub;
      if (isNewSession && unreadByHub.has(targetHub)) {
        unreadByHub = new Map(unreadByHub);
        unreadByHub.delete(targetHub);
      }

      const focusedHubHash = s.focusedHubHash ?? targetHub;
      const mirror = focusedHubHash === targetHub ? mirrorFromSession(targetHub, nextSession) : {};
      return { sessionsByHub, unreadByHub, focusedHubHash, ...mirror };
    });
  },

  setError: (message, hubHash) => {
    set((s) => mutateHubSession(s, hubHash, (session) => ({ ...session, lastError: message })));
  },

  roomJoined: (room, members, hubHash) => {
    set((s) =>
      mutateHubSession(s, hubHash, (session) => {
        const { key, existing, rooms } = coalesceRoomAliases(session.rooms, room);
        const incoming = members ?? [];
        // rrcd defaults `include_joined_member_list=false`, so JOINED body is often empty.
        // Empty must not wipe a roster filled by `/who`. Non-empty JOINED (full list or
        // single-peer join notify) merges by identity hash.
        let nextMembers: RrcRoomMember[];
        if (incoming.length === 0) {
          nextMembers = existing?.members ? [...existing.members] : [];
        } else if (!existing?.members?.length) {
          nextMembers = incoming.map((m) => ({
            identity_hash: m.identity_hash.toLowerCase(),
            nickname: m.nickname,
          }));
        } else {
          const byHash = new Map<string, RrcRoomMember>();
          for (const m of existing.members) {
            byHash.set(m.identity_hash.toLowerCase(), m);
          }
          for (const m of incoming) {
            const h = m.identity_hash.toLowerCase();
            const prev = [...byHash.values()].find(
              (p) =>
                rrcIdentityHashesMatch(p.identity_hash, h) ||
                (Boolean(m.nickname?.trim()) &&
                  Boolean(p.nickname?.trim()) &&
                  m.nickname!.trim().toLowerCase() === p.nickname!.trim().toLowerCase()),
            );
            if (prev) {
              byHash.delete(prev.identity_hash.toLowerCase());
              const [upgraded] = coalesceRrcMemberRoster([m], [prev], {
                keepUnmatchedExisting: false,
              });
              if (upgraded) byHash.set(upgraded.identity_hash.toLowerCase(), upgraded);
            } else {
              byHash.set(h, {
                identity_hash: h,
                nickname: m.nickname ?? null,
              });
            }
          }
          nextMembers = [...byHash.values()];
        }
        rooms.set(key, {
          name: existing?.name && rrcRoomsMatch(existing.name, key) ? existing.name : room,
          members: nextMembers.slice(0, MAX_MEMBERS_PER_ROOM),
          member_count: Math.min(nextMembers.length, MAX_MEMBERS_PER_ROOM),
          topic: existing?.topic ?? null,
        });
        const activeRoom =
          session.activeRoom && rrcRoomsMatch(session.activeRoom, key)
            ? key
            : (session.activeRoom ?? key);
        return { ...session, rooms: trimRoomMap(rooms), activeRoom };
      }),
    );
  },

  roomParted: (room, opts, hubHash) => {
    set((s) => {
      const hub = hubHash !== undefined ? normHub(hubHash) : s.focusedHubHash;
      if (!hub) return {};
      const existing = s.sessionsByHub.get(hub) ?? emptyHubSession();
      const rooms = new Map(existing.rooms);
      const aliases = [...rooms.keys()].filter((k) => rrcRoomsMatch(k, room));
      for (const alias of aliases) rooms.delete(alias);

      const messages = new Map(s.messages);
      if (!opts?.forced) {
        for (const alias of aliases) messages.delete(msgKey(hub, alias));
      }

      const unreadByRoom = new Map(existing.unreadByRoom);
      for (const [rk] of existing.unreadByRoom) {
        if (rrcRoomsMatch(rk, room)) unreadByRoom.delete(rk);
      }
      const partIntentRooms = new Set(existing.partIntentRooms);
      for (const k of [...partIntentRooms]) {
        if (rrcRoomsMatch(k, room)) partIntentRooms.delete(k);
      }
      const activeGone = existing.activeRoom != null && rrcRoomsMatch(existing.activeRoom, room);
      const nextSession: RrcHubSessionState = {
        ...existing,
        rooms,
        unreadByRoom,
        partIntentRooms,
        activeRoom: activeGone ? null : existing.activeRoom,
      };
      const sessionsByHub = new Map(s.sessionsByHub);
      sessionsByHub.set(hub, nextSession);
      const mirror = hub === s.focusedHubHash ? mirrorFromSession(hub, nextSession) : {};
      return { sessionsByHub, messages, ...mirror };
    });
  },

  addMessage: (msg, opts) => {
    const toPersist: { hub: string; msg: RrcChatMessage }[] = [];
    set((s) => {
      const hub = opts?.hubDestHash !== undefined ? normHub(opts.hubDestHash) : s.focusedHubHash;
      if (!hub) return {};
      const room = msg.room?.trim() ? msg.room : RRC_HUB_STREAM_ROOM;
      const roomKey = roomStorageKey(room);
      const key = msgKey(hub, roomKey);
      const messages = new Map(s.messages);
      const existing = messages.get(key) ?? [];
      if (msg.id && existing.some((m) => m.id === msg.id)) {
        return {};
      }
      // Hub often re-acks the same join-info / status NOTICE; keep one line.
      if (
        (msg.kind === 'notice' || msg.kind === 'system') &&
        existing.length > 0 &&
        existing[existing.length - 1]?.kind === msg.kind &&
        existing[existing.length - 1]?.body === msg.body
      ) {
        return {};
      }
      const stored: RrcChatMessage = { ...msg, room: roomKey };
      const list = [...existing, stored].slice(-MAX_MESSAGES_PER_ROOM);
      messages.set(key, list);
      toPersist.push({ hub, msg: stored });

      const session = s.sessionsByHub.get(hub) ?? emptyHubSession();
      const selfHash = s.localIdentityHash;
      const isSelf =
        Boolean(selfHash && msg.sender_hash?.toLowerCase() === selfHash) ||
        Boolean(msg.nickname && msg.nickname === s.nickname && !msg.sender_hash);
      // Only the focused hub+room counts as "viewing" — a background hub's
      // activeRoom must not suppress unread for that hub.
      const viewing =
        hub === s.focusedHubHash &&
        session.activeRoom != null &&
        rrcRoomsMatch(session.activeRoom, roomKey);

      let nextSession = session;
      if (opts?.bumpUnread && !isSelf && !viewing) {
        const unreadByRoom = new Map(session.unreadByRoom);
        unreadByRoom.set(roomKey, (unreadByRoom.get(roomKey) ?? 0) + 1);
        nextSession = { ...session, unreadByRoom };
      }
      const sessionsByHub = new Map(s.sessionsByHub);
      sessionsByHub.set(hub, nextSession);
      const mirror = hub === s.focusedHubHash ? mirrorFromSession(hub, nextSession) : {};
      return { messages, sessionsByHub, ...mirror };
    });
    for (const item of toPersist) {
      persistRrcMessage(item.hub, item.msg);
    }
  },

  mergeHistoryMessages: (hubHash, room, history) => {
    set((s) => {
      const hub = normHub(hubHash);
      if (!hub || history.length === 0) return {};
      const roomKey = roomStorageKey(room);
      const key = msgKey(hub, roomKey);
      const messages = new Map(s.messages);
      const existing = messages.get(key) ?? [];
      const seen = new Set(existing.map((m) => m.id).filter(Boolean));
      const incoming = history
        .filter((m) => m.id && !seen.has(m.id))
        .map((m) => ({ ...m, room: roomKey }));
      if (incoming.length === 0) return {};
      const merged = [...incoming, ...existing]
        .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
        .slice(-MAX_MESSAGES_PER_ROOM);
      messages.set(key, merged);
      return { messages };
    });
  },

  clearRoomMessages: (hubHash, room) => {
    set((s) => {
      const hub = normHub(hubHash);
      if (!hub) return {};
      const messages = new Map(s.messages);
      messages.delete(msgKey(hub, room));
      return { messages };
    });
  },

  clearUnread: (room, hubHash) => {
    set((s) =>
      mutateHubSession(s, hubHash, (session) => {
        const unreadByRoom = new Map(session.unreadByRoom);
        for (const [rk] of session.unreadByRoom) {
          if (rrcRoomsMatch(rk, room)) unreadByRoom.delete(rk);
        }
        return { ...session, unreadByRoom };
      }),
    );
  },

  clearActiveRoomMessages: (hubHash) => {
    set((s) => {
      const hub = hubHash !== undefined ? normHub(hubHash) : s.focusedHubHash;
      const room = hub ? s.sessionsByHub.get(hub)?.activeRoom : null;
      if (!hub || !room) return {};
      const messages = new Map(s.messages);
      messages.delete(msgKey(hub, room));
      return { messages };
    });
  },

  clearSession: () => {
    set(() => ({
      sessionsByHub: new Map(),
      focusedHubHash: null,
      messages: new Map(),
      unreadByHub: new Map(),
      ...mirrorFromSession(null, emptyHubSession()),
    }));
  },

  clearHubSession: (hubHash) => {
    set((s) => {
      const hub = normHub(hubHash);
      if (!hub) return {};
      clearHydratedRrcRoomKeysForHub(hub);
      return removeHubSession(s, hub);
    });
  },

  totalUnread: () => {
    const s = get();
    let total = 0;
    for (const session of s.sessionsByHub.values()) {
      for (const v of session.unreadByRoom.values()) total += v;
    }
    for (const v of s.unreadByHub.values()) total += v;
    return total;
  },

  unreadForHub: (hubHash) => {
    const hub = normHub(hubHash);
    if (!hub) return 0;
    const s = get();
    const session = s.sessionsByHub.get(hub);
    if (session) {
      let fromRooms = 0;
      for (const v of session.unreadByRoom.values()) fromRooms += v;
      if (fromRooms > 0) return fromRooms;
    }
    return s.unreadByHub.get(hub) ?? 0;
  },

  messagesForActiveRoom: () => {
    const s = get();
    const hub = s.focusedHubHash;
    const room = s.activeRoom;
    if (!hub || !room) return [];
    return s.messages.get(msgKey(hub, room)) ?? [];
  },

  roomMessageKey: (room, hubHash) => {
    const s = get();
    const hub = hubHash !== undefined ? normHub(hubHash) : s.focusedHubHash;
    if (!hub) return null;
    return msgKey(hub, room);
  },
}));
