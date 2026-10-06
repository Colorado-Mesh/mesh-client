import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const CHAT_MACRO_SLOT_COUNT = 12;
export const CHAT_MACRO_LABEL_MAX = 24;
export const CHAT_MACRO_TEXT_MAX = 500;
export const CHAT_MACROS_STORAGE_KEY = 'mesh-client:chatMacros';

export type ChatMacroSize = 'small' | 'medium' | 'large';
export type ChatMacroSendMode = 'insert' | 'sendNow';

export interface ChatMacroSlot {
  label: string;
  text: string;
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
  setSize: (size: ChatMacroSize) => void;
  setSendMode: (mode: ChatMacroSendMode) => void;
  setCollapsed: (collapsed: boolean) => void;
  markUsed: (index: number) => void;
}

function emptySlots(): ChatMacroSlot[] {
  return Array.from({ length: CHAT_MACRO_SLOT_COUNT }, () => ({ label: '', text: '' }));
}

const DEFAULT_PERSISTED: ChatMacrosPersisted = {
  slots: emptySlots(),
  size: null,
  sendMode: 'insert',
  collapsed: true,
};

function isSlotIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CHAT_MACRO_SLOT_COUNT;
}

function sanitizeSlot(raw: unknown): ChatMacroSlot {
  if (raw === null || typeof raw !== 'object') return { label: '', text: '' };
  const { label, text } = raw as { label?: unknown; text?: unknown };
  return {
    label: typeof label === 'string' ? label.slice(0, CHAT_MACRO_LABEL_MAX) : '',
    text: typeof text === 'string' ? text.slice(0, CHAT_MACRO_TEXT_MAX) : '',
  };
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
  return !slot || slot.text.trim() === '';
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
