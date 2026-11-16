import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const CHAT_MACRO_SLOT_COUNT = 12;
export const CHAT_MACRO_LABEL_MAX = 24;
export const CHAT_MACRO_TEXT_MAX = 500;
export const CHAT_MACROS_STORAGE_KEY = 'mesh-client:chatMacros';

export type ChatMacroSize = 'small' | 'medium' | 'large';
export type ChatMacroSendMode = 'insert' | 'sendNow';
export type ChatMacroAction = 'text' | 'room';

const MESHCORE_ROOM_PUBKEY_RE = /^[0-9a-f]{64}$/i;
const RRC_HUB_HASH_RE = /^[0-9a-f]+$/i;

export type RoomMacroTarget =
  | {
      kind: 'meshcore-room';
      /** MeshCore identity whose radio owns the room contact. */
      identityId: string;
      /** Lowercase hex room-server public key — stable across node-id churn. */
      roomPubKeyHex: string;
      /** Display snapshot only; refreshed in the editor, never used for routing. */
      label: string;
    }
  | {
      kind: 'meshcore-channel';
      identityId: string;
      /** Live slot at last save; remapped at jump via `channelKey` when present. */
      channelIndex: number;
      /** Stable channel identity key (name+PSK digest); preferred over index. */
      channelKey?: string;
      label: string;
    }
  | {
      kind: 'meshtastic-channel';
      identityId: string;
      channelIndex: number;
      channelKey?: string;
      label: string;
    }
  | {
      kind: 'rrc-room';
      /** Lowercase hub destination hash. */
      hubDestHash: string;
      /** Room name as shown in the RRC room list (may include `#`). */
      room: string;
      label: string;
    };

export interface ChatMacroSlot {
  label: string;
  text: string;
  /** Missing in persisted v1 data → treated as 'text'. */
  action?: ChatMacroAction;
  /** Present only when action === 'room'. */
  room?: RoomMacroTarget;
}

interface ChatMacrosPersisted {
  slots: ChatMacroSlot[];
  /** Null follows the pointer: large on touch screens, small otherwise. */
  size: ChatMacroSize | null;
  sendMode: ChatMacroSendMode;
  collapsed: boolean;
}

interface ChatMacrosState extends ChatMacrosPersisted {
  /** Session only: highlights the macro used last. */
  lastUsedIndex: number | null;
  setSlotLabel: (index: number, label: string) => void;
  setSlotText: (index: number, text: string) => void;
  setSlotAction: (index: number, action: ChatMacroAction) => void;
  setSlotRoom: (index: number, room: RoomMacroTarget | null) => void;
  setSize: (size: ChatMacroSize) => void;
  setSendMode: (mode: ChatMacroSendMode) => void;
  setCollapsed: (collapsed: boolean) => void;
  markUsed: (index: number) => void;
}

function emptySlots(): ChatMacroSlot[] {
  return Array.from({ length: CHAT_MACRO_SLOT_COUNT }, () => ({
    label: '',
    text: '',
    action: 'text' as const,
  }));
}

const DEFAULT_PERSISTED: ChatMacrosPersisted = {
  slots: emptySlots(),
  size: null,
  sendMode: 'insert',
  /** Expanded by default so MeshCore (and other) quick messages match companion-app canned UX. */
  collapsed: false,
};

function isSlotIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CHAT_MACRO_SLOT_COUNT;
}

export function sanitizeRoomTarget(raw: unknown): RoomMacroTarget | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label.slice(0, CHAT_MACRO_LABEL_MAX) : '';
  if (r.kind === 'meshcore-room') {
    const identityId = typeof r.identityId === 'string' ? r.identityId.trim() : '';
    const roomPubKeyHex = typeof r.roomPubKeyHex === 'string' ? r.roomPubKeyHex.trim() : '';
    if (!identityId || !MESHCORE_ROOM_PUBKEY_RE.test(roomPubKeyHex)) return undefined;
    return {
      kind: 'meshcore-room',
      identityId,
      roomPubKeyHex: roomPubKeyHex.toLowerCase(),
      label,
    };
  }
  if (r.kind === 'meshcore-channel' || r.kind === 'meshtastic-channel') {
    const identityId = typeof r.identityId === 'string' ? r.identityId.trim() : '';
    const channelIndex =
      typeof r.channelIndex === 'number' && Number.isInteger(r.channelIndex) ? r.channelIndex : NaN;
    if (!identityId || !Number.isInteger(channelIndex) || channelIndex < 0) return undefined;
    const channelKey =
      typeof r.channelKey === 'string' && r.channelKey.trim()
        ? r.channelKey.trim().toLowerCase()
        : undefined;
    if (r.kind === 'meshcore-channel') {
      return {
        kind: 'meshcore-channel',
        identityId,
        channelIndex,
        ...(channelKey ? { channelKey } : {}),
        label,
      };
    }
    return {
      kind: 'meshtastic-channel',
      identityId,
      channelIndex,
      ...(channelKey ? { channelKey } : {}),
      label,
    };
  }
  if (r.kind === 'rrc-room') {
    const hubDestHash = typeof r.hubDestHash === 'string' ? r.hubDestHash.trim() : '';
    const room = typeof r.room === 'string' ? r.room.trim() : '';
    if (!hubDestHash || !RRC_HUB_HASH_RE.test(hubDestHash) || !room) return undefined;
    return {
      kind: 'rrc-room',
      hubDestHash: hubDestHash.toLowerCase(),
      room,
      label,
    };
  }
  return undefined;
}

function sanitizeSlot(raw: unknown): ChatMacroSlot {
  if (raw === null || typeof raw !== 'object') return { label: '', text: '', action: 'text' };
  const r = raw as { label?: unknown; text?: unknown; action?: unknown; room?: unknown };
  const label = typeof r.label === 'string' ? r.label.slice(0, CHAT_MACRO_LABEL_MAX) : '';
  const text = typeof r.text === 'string' ? r.text.slice(0, CHAT_MACRO_TEXT_MAX) : '';
  const room = r.action === 'room' ? sanitizeRoomTarget(r.room) : undefined;
  if (r.action === 'room' && room) {
    return { label, text, action: 'room', room };
  }
  return { label, text, action: 'text' };
}

/** Coerce rehydrated localStorage into a valid shape; unknown fields fall back to defaults. */
export function sanitizeChatMacrosPersisted(raw: unknown): ChatMacrosPersisted {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_PERSISTED, slots: emptySlots() };
  const r = raw as Record<string, unknown>;
  const rawSlots = Array.isArray(r.slots) ? (r.slots as unknown[]) : [];
  const slots = Array.from({ length: CHAT_MACRO_SLOT_COUNT }, (_, i) => sanitizeSlot(rawSlots[i]));
  const size = r.size === 'small' || r.size === 'medium' || r.size === 'large' ? r.size : null;
  const sendMode = r.sendMode === 'sendNow' ? 'sendNow' : 'insert';
  const collapsed = typeof r.collapsed === 'boolean' ? r.collapsed : DEFAULT_PERSISTED.collapsed;
  return { slots, size, sendMode, collapsed };
}

export function isChatMacroSlotEmpty(slot: ChatMacroSlot | undefined): boolean {
  if (!slot) return true;
  if (slot.action === 'room') return slot.room == null;
  return slot.text.trim() === '';
}

export function prefersCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
}

export function resolveChatMacroSize(size: ChatMacroSize | null): ChatMacroSize {
  if (size) return size;
  return prefersCoarsePointer() ? 'large' : 'small';
}

function updateSlot(
  slots: ChatMacroSlot[],
  index: number,
  patch: Partial<ChatMacroSlot>,
): ChatMacroSlot[] {
  return slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot));
}

export const useChatMacrosStore = create<ChatMacrosState>()(
  persist(
    (set) => ({
      ...DEFAULT_PERSISTED,
      slots: emptySlots(),
      lastUsedIndex: null,
      setSlotLabel: (index, label) => {
        if (!isSlotIndex(index)) return;
        set((s) => ({
          slots: updateSlot(s.slots, index, { label: label.slice(0, CHAT_MACRO_LABEL_MAX) }),
        }));
      },
      setSlotText: (index, text) => {
        if (!isSlotIndex(index)) return;
        set((s) => ({
          slots: updateSlot(s.slots, index, { text: text.slice(0, CHAT_MACRO_TEXT_MAX) }),
        }));
      },
      setSlotAction: (index, action) => {
        if (!isSlotIndex(index)) return;
        set((s) => {
          const slot = s.slots[index];
          if (!slot) return s;
          if (action === 'room') {
            // Keep text and any existing room so switching back restores them.
            const next: ChatMacroSlot = {
              label: slot.label,
              text: slot.text,
              action: 'room',
              ...(slot.room ? { room: slot.room } : {}),
            };
            return {
              slots: s.slots.map((row, i) => (i === index ? next : row)),
            };
          }
          // Drop room from the object so it is not persisted while action is text.
          const next: ChatMacroSlot = { label: slot.label, text: slot.text, action: 'text' };
          return {
            slots: s.slots.map((row, i) => (i === index ? next : row)),
          };
        });
      },
      setSlotRoom: (index, room) => {
        if (!isSlotIndex(index)) return;
        set((s) => {
          const slot = s.slots[index];
          if (!slot) return s;
          if (room == null) {
            const next: ChatMacroSlot = {
              label: slot.label,
              text: slot.text,
              action: slot.action === 'room' ? 'room' : 'text',
            };
            return {
              slots: s.slots.map((row, i) => (i === index ? next : row)),
            };
          }
          const next: ChatMacroSlot = {
            label: slot.label,
            text: slot.text,
            action: 'room',
            room,
          };
          return {
            slots: s.slots.map((row, i) => (i === index ? next : row)),
          };
        });
      },
      setSize: (size) => set({ size }),
      setSendMode: (sendMode) => set({ sendMode }),
      setCollapsed: (collapsed) => set({ collapsed }),
      markUsed: (index) => {
        if (!isSlotIndex(index)) return;
        set({ lastUsedIndex: index });
      },
    }),
    {
      name: CHAT_MACROS_STORAGE_KEY,
      version: 1,
      partialize: (s): ChatMacrosPersisted => ({
        slots: s.slots,
        size: s.size,
        sendMode: s.sendMode,
        collapsed: s.collapsed,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizeChatMacrosPersisted(persisted) }),
    },
  ),
);

/** Test helper: restore defaults without touching other stores. */
export function resetChatMacrosStoreForTests(): void {
  useChatMacrosStore.setState({ ...DEFAULT_PERSISTED, slots: emptySlots(), lastUsedIndex: null });
}
