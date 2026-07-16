import { create } from 'zustand';

import type {
  RrcChatMessage,
  RrcRoomInfo,
  RrcRoomMember,
  RrcSessionStatus,
} from '@/shared/rrc-types';

const MAX_MESSAGES_PER_ROOM = 500;

/** Synthetic room key for hub-scoped NOTICE/ERROR with no K_ROOM. */
export const RRC_HUB_STREAM_ROOM = '[hub]';

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
  rooms: Map<string, RrcRoomInfo>;
  /** Volatile messages keyed by `${hub}::${room}`. */
  messages: Map<string, RrcChatMessage[]>;
  activeRoom: string | null;
  lastError: string | null;
  unreadByRoom: Map<string, number>;
  showTimestamps: boolean;
  setNickname: (nick: string) => void;
  setLocalIdentityHash: (hash: string | null) => void;
  setActiveRoom: (room: string | null) => void;
  setShowTimestamps: (show: boolean) => void;
  applyStatus: (
    status: RrcSessionStatus,
    hubDestHash?: string | null,
    hubName?: string | null,
  ) => void;
  setError: (message: string | null) => void;
  roomJoined: (room: string, members?: RrcRoomMember[]) => void;
  roomParted: (room: string) => void;
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
  rooms: new Map(),
  messages: new Map(),
  activeRoom: null,
  lastError: null,
  unreadByRoom: new Map(),
  showTimestamps: false,

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
      rooms.set(key, {
        name: room,
        members: members ?? rooms.get(key)?.members ?? [],
        member_count: members?.length ?? rooms.get(key)?.member_count,
      });
      return {
        rooms,
        activeRoom: s.activeRoom ?? key,
      };
    });
  },

  roomParted: (room) => {
    const key = normRoom(room);
    set((s) => {
      const rooms = new Map(s.rooms);
      rooms.delete(key);
      const hub = s.hubDestHash;
      const messages = new Map(s.messages);
      if (hub) messages.delete(msgKey(hub, key));
      const unread = new Map(s.unreadByRoom);
      unread.delete(key);
      return {
        rooms,
        messages,
        unreadByRoom: unread,
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
      unreadByRoom: new Map(),
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
