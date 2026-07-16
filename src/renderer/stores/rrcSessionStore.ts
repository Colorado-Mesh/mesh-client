import { create } from 'zustand';

import {
  coalesceRrcMemberRoster,
  dedupeRrcMembers,
  rrcIdentityHashesMatch,
} from '@/renderer/lib/rrcRoomMembers';
import { rrcRoomMatchKey, rrcRoomsMatch } from '@/renderer/lib/rrcRoomName';
import type {
  RrcChatMessage,
  RrcHubCapabilities,
  RrcListedRoom,
  RrcRoomInfo,
  RrcRoomMember,
  RrcSessionStatus,
} from '@/shared/rrc-types';

const MAX_MESSAGES_PER_ROOM = 500;

/** Synthetic room key for hub-scoped NOTICE/ERROR with no K_ROOM. */
export const RRC_HUB_STREAM_ROOM = '[hub]';

/** Synthetic room for direct NOTICE whispers (K_DST). */
export const RRC_WHISPERS_ROOM = '[whispers]';

function normRoom(room: string): string {
  return room.trim().toLowerCase();
}

function normHub(hub: string | null | undefined): string | null {
  if (!hub) return null;
  const h = hub.trim().toLowerCase();
  return h || null;
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

interface RrcSessionStoreState {
  status: RrcSessionStatus;
  hubDestHash: string | null;
  hubName: string | null;
  nickname: string;
  /** Local Reticulum identity hash (hex) for self-echo unread suppression. */
  localIdentityHash: string | null;
  capabilities: RrcHubCapabilities;
  rooms: Map<string, RrcRoomInfo>;
  listedRooms: RrcListedRoom[];
  /** Volatile messages keyed by `${hub}::${room}`. */
  messages: Map<string, RrcChatMessage[]>;
  activeRoom: string | null;
  lastError: string | null;
  /** Sticky moderation / remote-takedown banner. */
  moderationBanner: string | null;
  unreadByRoom: Map<string, number>;
  /** Per-hub unread totals (survives disconnect wipe of room maps). */
  unreadByHub: Map<string, number>;
  showTimestamps: boolean;
  /** True while a local PART is in flight (voluntary leave). */
  partIntentRooms: Set<string>;
  /** True when user requested disconnect (not hub drop). */
  disconnectIntent: boolean;
  setNickname: (nick: string) => void;
  setLocalIdentityHash: (hash: string | null) => void;
  setActiveRoom: (room: string | null) => void;
  setShowTimestamps: (show: boolean) => void;
  setCapabilities: (caps: RrcHubCapabilities) => void;
  setListedRooms: (rooms: RrcListedRoom[]) => void;
  setRoomTopic: (room: string, topic: string | null) => void;
  mergeRoomMembers: (room: string, members: RrcRoomMember[], mode?: 'replace' | 'merge') => void;
  markPartIntent: (room: string) => void;
  clearPartIntent: (room: string) => void;
  setDisconnectIntent: (intent: boolean) => void;
  setModerationBanner: (message: string | null) => void;
  applyStatus: (
    status: RrcSessionStatus,
    hubDestHash?: string | null,
    hubName?: string | null,
  ) => void;
  setError: (message: string | null) => void;
  roomJoined: (room: string, members?: RrcRoomMember[]) => void;
  /**
   * Remove room membership. When `forced`, treat as remote takedown and keep
   * a system trail (caller should set moderationBanner).
   */
  roomParted: (room: string, opts?: { forced?: boolean }) => void;
  addMessage: (msg: RrcChatMessage, opts?: { bumpUnread?: boolean }) => void;
  clearUnread: (room: string) => void;
  clearActiveRoomMessages: () => void;
  clearSession: () => void;
  /** Sum of live room unreads, or stashed hub totals when rooms were wiped. */
  totalUnread: () => number;
  unreadForHub: (hubHash: string) => number;
  messagesForActiveRoom: () => RrcChatMessage[];
  roomMessageKey: (room: string) => string | null;
}

export const useRrcSessionStore = create<RrcSessionStoreState>((set, get) => ({
  status: 'disconnected',
  hubDestHash: null,
  hubName: null,
  nickname: 'mesh-client',
  localIdentityHash: null,
  capabilities: {},
  rooms: new Map(),
  listedRooms: [],
  messages: new Map(),
  activeRoom: null,
  lastError: null,
  moderationBanner: null,
  unreadByRoom: new Map(),
  unreadByHub: new Map(),
  showTimestamps: false,
  partIntentRooms: new Set(),
  disconnectIntent: false,

  setNickname: (nick) => {
    set({ nickname: nick.trim() || 'mesh-client' });
  },

  setLocalIdentityHash: (hash) => {
    set({ localIdentityHash: hash ? hash.trim().toLowerCase() : null });
  },

  setActiveRoom: (room) => {
    if (!room) {
      set({ activeRoom: null });
      return;
    }
    set((s) => {
      const soft = [...s.rooms.keys()].find((k) => rrcRoomsMatch(k, room));
      const key = soft ?? normRoom(room);
      const unread = new Map(s.unreadByRoom);
      let cleared = 0;
      for (const [rk, count] of unread) {
        if (rrcRoomsMatch(rk, key)) {
          cleared += count;
          unread.delete(rk);
        }
      }
      const unreadByHub = new Map(s.unreadByHub);
      const hub = s.hubDestHash;
      if (hub && cleared > 0) {
        const next = Math.max(0, (unreadByHub.get(hub) ?? 0) - cleared);
        if (next === 0) unreadByHub.delete(hub);
        else unreadByHub.set(hub, next);
      }
      return { activeRoom: key, unreadByRoom: unread, unreadByHub };
    });
  },

  setShowTimestamps: (show) => {
    set({ showTimestamps: show });
  },

  setCapabilities: (caps) => {
    set({ capabilities: caps });
  },

  setListedRooms: (rooms) => {
    set({ listedRooms: rooms });
  },

  setRoomTopic: (room, topic) => {
    set((s) => {
      const { key, existing, rooms } = coalesceRoomAliases(s.rooms, room);
      if (existing || rooms.has(key)) {
        const cur = rooms.get(key) ?? existing;
        rooms.set(key, {
          name: cur?.name ?? room,
          members: cur?.members,
          member_count: cur?.member_count,
          topic: topic || null,
        });
      }
      const listedRooms = s.listedRooms.map((r) =>
        rrcRoomsMatch(r.name, room) ? { ...r, topic: topic || undefined } : r,
      );
      return { rooms, listedRooms };
    });
  },

  mergeRoomMembers: (room, members, mode = 'replace') => {
    set((s) => {
      const { key, existing, rooms } = coalesceRoomAliases(s.rooms, room);
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
        // `/who` snapshot: hub membership + upgrade prefixes/nicks from live chat.
        nextMembers = coalesceRrcMemberRoster(members, existing?.members);
      }
      rooms.set(key, {
        name: existing?.name ?? room,
        topic: existing?.topic,
        members: nextMembers,
        member_count: nextMembers.length,
      });
      return { rooms };
    });
  },

  markPartIntent: (room) => {
    const key = rrcRoomMatchKey(room) || normRoom(room);
    set((s) => {
      const next = new Set(s.partIntentRooms);
      next.add(key);
      return { partIntentRooms: next };
    });
  },

  clearPartIntent: (room) => {
    set((s) => {
      const next = new Set(s.partIntentRooms);
      for (const k of [...next]) {
        if (rrcRoomsMatch(k, room)) next.delete(k);
      }
      return { partIntentRooms: next };
    });
  },

  setDisconnectIntent: (intent) => {
    set({ disconnectIntent: intent });
  },

  setModerationBanner: (message) => {
    set({ moderationBanner: message });
  },

  applyStatus: (status, hubDestHash, hubName) => {
    set((s) => {
      const nextHub = hubDestHash !== undefined ? normHub(hubDestHash) : s.hubDestHash;
      const hubChanged = nextHub != null && s.hubDestHash != null && nextHub !== s.hubDestHash;
      const disconnecting = status === 'disconnected';
      const wipeVolatile = disconnecting || hubChanged;
      let unreadByHub = s.unreadByHub;
      if (wipeVolatile) {
        unreadByHub = new Map(s.unreadByHub);
        // Stash live room unreads onto the hub that is going away.
        const stashHub = hubChanged ? s.hubDestHash : disconnecting ? s.hubDestHash : null;
        if (stashHub) {
          let roomTotal = 0;
          for (const v of s.unreadByRoom.values()) roomTotal += v;
          if (roomTotal > 0) {
            unreadByHub.set(stashHub, Math.max(unreadByHub.get(stashHub) ?? 0, roomTotal));
          }
        }
      }
      return {
        status,
        hubDestHash: nextHub !== undefined ? nextHub : s.hubDestHash,
        hubName: hubName !== undefined ? hubName : s.hubName,
        ...(wipeVolatile
          ? {
              rooms: new Map(),
              messages: new Map(),
              activeRoom: null,
              unreadByRoom: new Map(),
              unreadByHub,
              listedRooms: [],
              capabilities: {},
              moderationBanner: null,
              partIntentRooms: new Set(),
            }
          : {}),
      };
    });
  },

  setError: (message) => {
    set({ lastError: message });
  },

  roomJoined: (room, members) => {
    set((s) => {
      const { key, existing, rooms } = coalesceRoomAliases(s.rooms, room);
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
        members: nextMembers,
        member_count: nextMembers.length,
        topic: existing?.topic ?? null,
      });
      const activeRoom =
        s.activeRoom && rrcRoomsMatch(s.activeRoom, key) ? key : (s.activeRoom ?? key);
      return {
        rooms,
        activeRoom,
      };
    });
  },

  roomParted: (room, opts) => {
    set((s) => {
      const rooms = new Map(s.rooms);
      const aliases = [...rooms.keys()].filter((k) => rrcRoomsMatch(k, room));
      for (const alias of aliases) rooms.delete(alias);
      const hub = s.hubDestHash;
      const messages = new Map(s.messages);
      const unread = new Map(s.unreadByRoom);
      const partIntentRooms = new Set(s.partIntentRooms);
      for (const alias of aliases) {
        if (hub && !opts?.forced) messages.delete(msgKey(hub, alias));
      }
      for (const [rk] of unread) {
        if (rrcRoomsMatch(rk, room)) unread.delete(rk);
      }
      for (const k of [...partIntentRooms]) {
        if (rrcRoomsMatch(k, room)) partIntentRooms.delete(k);
      }
      const activeGone = s.activeRoom != null && rrcRoomsMatch(s.activeRoom, room);
      return {
        rooms,
        messages,
        unreadByRoom: unread,
        partIntentRooms,
        activeRoom: activeGone ? null : s.activeRoom,
      };
    });
  },

  addMessage: (msg, opts) => {
    set((s) => {
      const hub = s.hubDestHash;
      if (!hub) return s;
      const room = msg.room?.trim() ? msg.room : RRC_HUB_STREAM_ROOM;
      const roomKey = roomStorageKey(room);
      const key = msgKey(hub, roomKey);
      const messages = new Map(s.messages);
      const existing = messages.get(key) ?? [];
      if (msg.id && existing.some((m) => m.id === msg.id)) {
        return s;
      }
      const list = [...existing, { ...msg, room: roomKey }].slice(-MAX_MESSAGES_PER_ROOM);
      messages.set(key, list);

      const selfHash = s.localIdentityHash;
      const isSelf =
        Boolean(selfHash && msg.sender_hash?.toLowerCase() === selfHash) ||
        Boolean(msg.nickname && msg.nickname === s.nickname && !msg.sender_hash);

      const unread = new Map(s.unreadByRoom);
      const viewing = s.activeRoom != null && rrcRoomsMatch(s.activeRoom, roomKey);
      let unreadByHub = s.unreadByHub;
      if (opts?.bumpUnread && !isSelf && !viewing) {
        unread.set(roomKey, (unread.get(roomKey) ?? 0) + 1);
        unreadByHub = new Map(s.unreadByHub);
        unreadByHub.set(hub, (unreadByHub.get(hub) ?? 0) + 1);
      }
      return { messages, unreadByRoom: unread, unreadByHub };
    });
  },

  clearUnread: (room) => {
    set((s) => {
      const unread = new Map(s.unreadByRoom);
      let cleared = 0;
      for (const [rk, count] of unread) {
        if (rrcRoomsMatch(rk, room)) {
          cleared += count;
          unread.delete(rk);
        }
      }
      const unreadByHub = new Map(s.unreadByHub);
      const hub = s.hubDestHash;
      if (hub && cleared > 0) {
        const next = Math.max(0, (unreadByHub.get(hub) ?? 0) - cleared);
        if (next === 0) unreadByHub.delete(hub);
        else unreadByHub.set(hub, next);
      }
      return { unreadByRoom: unread, unreadByHub };
    });
  },

  clearActiveRoomMessages: () => {
    set((s) => {
      const hub = s.hubDestHash;
      const room = s.activeRoom;
      if (!hub || !room) return s;
      const messages = new Map(s.messages);
      messages.delete(msgKey(hub, room));
      return { messages };
    });
  },

  clearSession: () => {
    set((s) => {
      const unreadByHub = new Map(s.unreadByHub);
      if (s.hubDestHash) {
        let roomTotal = 0;
        for (const v of s.unreadByRoom.values()) roomTotal += v;
        if (roomTotal > 0) {
          unreadByHub.set(s.hubDestHash, Math.max(unreadByHub.get(s.hubDestHash) ?? 0, roomTotal));
        }
      }
      return {
        status: 'disconnected',
        hubDestHash: null,
        hubName: null,
        rooms: new Map(),
        messages: new Map(),
        activeRoom: null,
        lastError: null,
        moderationBanner: null,
        unreadByRoom: new Map(),
        unreadByHub,
        listedRooms: [],
        capabilities: {},
        partIntentRooms: new Set(),
        disconnectIntent: false,
      };
    });
  },

  totalUnread: () => {
    const s = get();
    let fromRooms = 0;
    for (const v of s.unreadByRoom.values()) fromRooms += v;
    if (fromRooms > 0) return fromRooms;
    let fromHubs = 0;
    for (const v of s.unreadByHub.values()) fromHubs += v;
    return fromHubs;
  },

  unreadForHub: (hubHash) => {
    const hub = normHub(hubHash);
    if (!hub) return 0;
    const s = get();
    if (s.hubDestHash === hub) {
      let fromRooms = 0;
      for (const v of s.unreadByRoom.values()) fromRooms += v;
      if (fromRooms > 0) return fromRooms;
    }
    return s.unreadByHub.get(hub) ?? 0;
  },

  messagesForActiveRoom: () => {
    const s = get();
    const hub = s.hubDestHash;
    const room = s.activeRoom;
    if (!hub || !room) return [];
    return s.messages.get(msgKey(hub, room)) ?? [];
  },

  roomMessageKey: (room) => {
    const hub = get().hubDestHash;
    if (!hub) return null;
    return msgKey(hub, room);
  },
}));
