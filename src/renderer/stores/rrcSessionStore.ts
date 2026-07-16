import { create } from 'zustand';

import type {
  RrcChatMessage,
  RrcRoomInfo,
  RrcRoomMember,
  RrcSessionStatus,
} from '@/shared/rrc-types';

const MAX_MESSAGES_PER_ROOM = 500;

interface RrcSessionStoreState {
  status: RrcSessionStatus;
  hubDestHash: string | null;
  hubName: string | null;
  nickname: string;
  rooms: Map<string, RrcRoomInfo>;
  /** Volatile messages keyed by normalized room name. */
  messages: Map<string, RrcChatMessage[]>;
  activeRoom: string | null;
  lastError: string | null;
  unreadByRoom: Map<string, number>;
  showTimestamps: boolean;
  setNickname: (nick: string) => void;
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
  clearSession: () => void;
  totalUnread: () => number;
}

function normRoom(room: string): string {
  return room.trim().toLowerCase();
}

export const useRrcSessionStore = create<RrcSessionStoreState>((set, get) => ({
  status: 'disconnected',
  hubDestHash: null,
  hubName: null,
  nickname: 'mesh-client',
  rooms: new Map(),
  messages: new Map(),
  activeRoom: null,
  lastError: null,
  unreadByRoom: new Map(),
  showTimestamps: false,

  setNickname: (nick) => {
    set({ nickname: nick.trim() || 'mesh-client' });
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
    set((s) => ({
      status,
      hubDestHash: hubDestHash !== undefined ? hubDestHash : s.hubDestHash,
      hubName: hubName !== undefined ? hubName : s.hubName,
      ...(status === 'disconnected'
        ? { rooms: new Map(), messages: new Map(), activeRoom: null, unreadByRoom: new Map() }
        : {}),
    }));
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
      const messages = new Map(s.messages);
      messages.delete(key);
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
    const key = normRoom(msg.room);
    set((s) => {
      const messages = new Map(s.messages);
      const list = [...(messages.get(key) ?? []), msg].slice(-MAX_MESSAGES_PER_ROOM);
      messages.set(key, list);
      const unread = new Map(s.unreadByRoom);
      if (opts?.bumpUnread && s.activeRoom !== key) {
        unread.set(key, (unread.get(key) ?? 0) + 1);
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
}));
