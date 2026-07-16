import { create } from 'zustand';

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

function msgKey(hub: string, room: string): string {
  return `${hub}::${normRoom(room)}`;
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
  totalUnread: () => number;
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
    const key = normRoom(room);
    set((s) => {
      const unread = new Map(s.unreadByRoom);
      unread.delete(key);
      return { activeRoom: key, unreadByRoom: unread };
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
    const key = normRoom(room);
    set((s) => {
      const rooms = new Map(s.rooms);
      const existing = rooms.get(key);
      if (existing) {
        rooms.set(key, { ...existing, topic: topic || null });
      }
      const listedRooms = s.listedRooms.map((r) =>
        normRoom(r.name) === key ? { ...r, topic: topic || undefined } : r,
      );
      return { rooms, listedRooms };
    });
  },

  mergeRoomMembers: (room, members, mode = 'replace') => {
    const key = normRoom(room);
    set((s) => {
      const rooms = new Map(s.rooms);
      const existing = rooms.get(key);
      let nextMembers = members;
      if (mode === 'merge' && existing?.members?.length) {
        const byHash = new Map<string, RrcRoomMember>();
        for (const m of existing.members) {
          byHash.set(m.identity_hash.toLowerCase(), m);
        }
        for (const m of members) {
          const h = m.identity_hash.toLowerCase();
          const prev = [...byHash.values()].find(
            (p) =>
              p.identity_hash.toLowerCase() === h ||
              (h.length >= 8 &&
                !h.startsWith('nick:') &&
                p.identity_hash.toLowerCase().startsWith(h)) ||
              (Boolean(m.nickname) && p.nickname?.toLowerCase() === m.nickname?.toLowerCase()),
          );
          if (prev?.identity_hash.length === 32 && h.length < 32) {
            byHash.set(prev.identity_hash.toLowerCase(), {
              ...prev,
              nickname: m.nickname ?? prev.nickname,
            });
          } else {
            byHash.set(h, m);
          }
        }
        nextMembers = [...byHash.values()];
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
    const key = normRoom(room);
    set((s) => {
      const next = new Set(s.partIntentRooms);
      next.add(key);
      return { partIntentRooms: next };
    });
  },

  clearPartIntent: (room) => {
    const key = normRoom(room);
    set((s) => {
      const next = new Set(s.partIntentRooms);
      next.delete(key);
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
    const key = normRoom(room);
    set((s) => {
      const rooms = new Map(s.rooms);
      const existing = rooms.get(key);
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
          const prev = byHash.get(h);
          byHash.set(h, {
            identity_hash: h,
            nickname: m.nickname ?? prev?.nickname,
          });
        }
        nextMembers = [...byHash.values()];
      }
      rooms.set(key, {
        name: existing?.name ?? room,
        members: nextMembers,
        member_count: nextMembers.length,
        topic: existing?.topic ?? null,
      });
      return {
        rooms,
        activeRoom: s.activeRoom ?? key,
      };
    });
  },

  roomParted: (room, opts) => {
    const key = normRoom(room);
    set((s) => {
      const rooms = new Map(s.rooms);
      rooms.delete(key);
      const hub = s.hubDestHash;
      const messages = new Map(s.messages);
      if (hub && !opts?.forced) messages.delete(msgKey(hub, key));
      const unread = new Map(s.unreadByRoom);
      unread.delete(key);
      const partIntentRooms = new Set(s.partIntentRooms);
      partIntentRooms.delete(key);
      return {
        rooms,
        messages,
        unreadByRoom: unread,
        partIntentRooms,
        activeRoom: s.activeRoom === key ? null : s.activeRoom,
      };
    });
  },

  addMessage: (msg, opts) => {
    set((s) => {
      const hub = s.hubDestHash;
      if (!hub) return s;
      const room = msg.room?.trim() ? msg.room : RRC_HUB_STREAM_ROOM;
      const roomKey = normRoom(room);
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
      if (opts?.bumpUnread && !isSelf && s.activeRoom !== roomKey) {
        unread.set(roomKey, (unread.get(roomKey) ?? 0) + 1);
      }
      return { messages, unreadByRoom: unread };
    });
  },

  clearUnread: (room) => {
    const key = normRoom(room);
    set((s) => {
      const unread = new Map(s.unreadByRoom);
      unread.delete(key);
      return { unreadByRoom: unread };
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
    set({
      status: 'disconnected',
      hubDestHash: null,
      hubName: null,
      rooms: new Map(),
      messages: new Map(),
      activeRoom: null,
      lastError: null,
      moderationBanner: null,
      unreadByRoom: new Map(),
      listedRooms: [],
      capabilities: {},
      partIntentRooms: new Set(),
      disconnectIntent: false,
    });
  },

  totalUnread: () => {
    let n = 0;
    for (const v of get().unreadByRoom.values()) n += v;
    return n;
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
