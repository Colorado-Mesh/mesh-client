import { create } from 'zustand';

import { getWordFilterSettings, mergeAppSetting } from '../lib/appSettingsStorage';
import { isMecpMessage } from '../lib/mecp/mecpMessages';
import type { ChatMessage, MeshProtocol } from '../lib/types';

const DISABLED_CONV_KEY = 'mesh-client:wordFilterDisabledConversations:v1';
const MAX_WORDS = 200;
const MAX_WORD_LEN = 64;
const MAX_DISABLED_CONVERSATIONS = 500;

export interface WordFilterState {
  enabled: boolean;
  words: readonly string[];
  /**
   * Conversation keys where the filter is locally disabled.
   * Format: `{protocol}:ch:{index}` / `{protocol}:dm:{nodeId}` (protocol-scoped).
   */
  disabledConversations: ReadonlySet<string>;
  setEnabled: (enabled: boolean) => void;
  setWordsText: (text: string) => void;
  setConversationDisabled: (conversationKey: string, disabled: boolean) => void;
}

function sanitizeWords(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const word = entry.trim().toLowerCase();
    if (!word || word.length > MAX_WORD_LEN) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

function loadDisabledConversations(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(DISABLED_CONV_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== 'string' || !item) continue;
      out.add(item);
      if (out.size >= MAX_DISABLED_CONVERSATIONS) break;
    }
    return out;
  } catch (err) {
    console.warn('[wordFilterStore] load disabled conversations failed', err);
    return new Set();
  }
}

function saveDisabledConversations(keys: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      DISABLED_CONV_KEY,
      JSON.stringify([...keys].slice(-MAX_DISABLED_CONVERSATIONS)),
    );
  } catch (err) {
    console.warn('[wordFilterStore] save disabled conversations failed', err);
  }
}

function initialState() {
  const fallback = { enabled: false, words: [] as string[] };
  let settings = fallback;
  if (typeof window !== 'undefined') {
    try {
      settings = getWordFilterSettings();
    } catch (err) {
      // Tests often mock appSettingsStorage without this helper; stay import-safe.
      console.warn('[wordFilterStore] load settings failed', err);
      settings = fallback;
    }
  }
  return {
    enabled: settings.enabled,
    words: sanitizeWords(settings.words),
    disabledConversations: loadDisabledConversations(),
  };
}

export const useWordFilterStore = create<WordFilterState>()((set, get) => ({
  ...initialState(),
  setEnabled: (enabled) => {
    mergeAppSetting('wordFilterEnabled', enabled, 'wordFilterStore enabled');
    set({ enabled });
  },
  setWordsText: (text) => {
    const words = sanitizeWords(text.split(/[\n,]+/));
    mergeAppSetting('wordFilterWords', words, 'wordFilterStore words');
    set({ words });
  },
  setConversationDisabled: (conversationKey, disabled) => {
    const key = conversationKey.trim();
    if (!key) return;
    const current = get().disabledConversations;
    if (current.has(key) === disabled) return;
    const next = new Set(current);
    if (disabled) next.add(key);
    else next.delete(key);
    saveDisabledConversations(next);
    set({ disabledConversations: next });
  },
}));

/** Refresh caches after durable app-settings hydration. */
export function hydrateWordFilterPreferences(): void {
  useWordFilterStore.setState(initialState());
}

/** Protocol-scoped conversation key for word-filter exceptions. */
export function buildWordFilterConversationKey(
  protocol: MeshProtocol,
  scope: { kind: 'channel'; channel: number } | { kind: 'dm'; peer: number },
): string {
  if (scope.kind === 'dm') return `${protocol}:dm:${scope.peer}`;
  return `${protocol}:ch:${scope.channel}`;
}

function conversationKeyForMessage(msg: ChatMessage, protocol: MeshProtocol): string {
  if (msg.to != null && msg.to > 0) {
    return buildWordFilterConversationKey(protocol, { kind: 'dm', peer: msg.to });
  }
  // Own DM outbound uses sender as self; unread code uses destination — callers
  // should pass an explicit conversation key when available.
  return buildWordFilterConversationKey(protocol, { kind: 'channel', channel: msg.channel });
}

/** True when payload matches a filter word (case-insensitive substring). */
export function messageMatchesWordFilter(payload: string, words: readonly string[]): boolean {
  if (words.length === 0) return false;
  const lower = payload.toLowerCase();
  return words.some((word) => lower.includes(word));
}

/**
 * Hide matching messages from chat views / unread / beeps.
 * MECP / MAYDAY / URGENT lines never filter. Per-conversation disable skips the filter.
 */
export function isHiddenByWordFilter(
  msg: ChatMessage,
  protocol: MeshProtocol,
  conversationKey?: string,
): boolean {
  const state = useWordFilterStore.getState();
  if (!state.enabled || state.words.length === 0) return false;
  const key = conversationKey ?? conversationKeyForMessage(msg, protocol);
  if (state.disabledConversations.has(key)) return false;
  if (isMecpMessage(msg.payload)) return false;
  return messageMatchesWordFilter(msg.payload, state.words);
}
