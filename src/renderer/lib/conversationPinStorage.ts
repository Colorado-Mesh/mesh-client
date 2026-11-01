import { errLikeToLogString } from './errLikeToLogString';
import type { MeshProtocol } from './types';

/**
 * Per-conversation pin / archive preferences (chat tabs: `ch:<n>`, `dm:<n>` view keys).
 *
 * Persistence: one localStorage document per protocol + identity scope, so two identities on the
 * same protocol keep independent lists. This is deliberately separate from message starring
 * (`mesh-client:starred:*`) and mute (`conversationMuteStorage`).
 *
 * Failure point: localStorage read/write can throw (quota, disabled storage). Reads fall back to
 * an empty list; writes return false and leave the previous document untouched so callers can
 * keep their in-memory state unchanged.
 */
export const CONVERSATION_PINS_KEY_PREFIX = 'mesh-client:conversationPins:v1';
const DEFAULT_SCOPE = 'default';
const MAX_VIEW_KEYS = 500;
const MAX_VIEW_KEY_LENGTH = 128;

export interface ConversationPrefs {
  /** View keys shown first in the tab strip. */
  pinned: string[];
  /** View keys hidden from the tab strip unless "show archived" is on. */
  archived: string[];
}

export const EMPTY_CONVERSATION_PREFS: ConversationPrefs = Object.freeze({
  pinned: [],
  archived: [],
});

export function conversationPrefsStorageKey(
  protocol: MeshProtocol,
  identityId: string | null | undefined,
): string {
  return `${CONVERSATION_PINS_KEY_PREFIX}:${protocol}:${identityId ?? DEFAULT_SCOPE}`;
}

function sanitizeViewKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_VIEW_KEY_LENGTH) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= MAX_VIEW_KEYS) break;
  }
  return out;
}

/** Normalize a parsed document: dedupe, drop junk, and keep pin/archive mutually exclusive. */
export function normalizeConversationPrefs(value: unknown): ConversationPrefs {
  if (value == null || typeof value !== 'object') return { pinned: [], archived: [] };
  const raw = value as Partial<Record<keyof ConversationPrefs, unknown>>;
  const archived = sanitizeViewKeys(raw.archived);
  const archivedSet = new Set(archived);
  const pinned = sanitizeViewKeys(raw.pinned).filter((k) => !archivedSet.has(k));
  return { pinned, archived };
}

export function loadConversationPrefs(
  protocol: MeshProtocol,
  identityId: string | null | undefined,
): ConversationPrefs {
  try {
    const raw = localStorage.getItem(conversationPrefsStorageKey(protocol, identityId));
    if (!raw) return { pinned: [], archived: [] };
    return normalizeConversationPrefs(JSON.parse(raw));
  } catch (e) {
    console.debug('[conversationPinStorage] load failed ' + errLikeToLogString(e));
    return { pinned: [], archived: [] };
  }
}

type PrefsListener = (protocol: MeshProtocol, identityId: string | null) => void;
const listeners = new Set<PrefsListener>();

export function subscribeConversationPrefs(listener: PrefsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyConversationPrefsChanged(protocol: MeshProtocol, identityId: string | null): void {
  for (const listener of [...listeners]) {
    try {
      listener(protocol, identityId);
    } catch (e) {
      console.warn('[conversationPinStorage] listener failed ' + errLikeToLogString(e));
    }
  }
}

/** Persist prefs. Returns false (previous document intact) when the write throws. */
export function saveConversationPrefs(
  protocol: MeshProtocol,
  identityId: string | null | undefined,
  prefs: ConversationPrefs,
): boolean {
  const next = normalizeConversationPrefs(prefs);
  const key = conversationPrefsStorageKey(protocol, identityId);
  try {
    if (next.pinned.length === 0 && next.archived.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(next));
    }
  } catch (e) {
    console.warn('[conversationPinStorage] save failed ' + errLikeToLogString(e));
    return false;
  }
  notifyConversationPrefsChanged(protocol, identityId ?? null);
  return true;
}

/** Pure toggle: pinning an archived view unarchives it. */
export function togglePinned(prefs: ConversationPrefs, viewKey: string): ConversationPrefs {
  if (prefs.pinned.includes(viewKey)) {
    return { pinned: prefs.pinned.filter((k) => k !== viewKey), archived: prefs.archived };
  }
  return {
    pinned: [...prefs.pinned, viewKey],
    archived: prefs.archived.filter((k) => k !== viewKey),
  };
}

/** Pure toggle: archiving a pinned view unpins it. */
export function toggleArchived(prefs: ConversationPrefs, viewKey: string): ConversationPrefs {
  if (prefs.archived.includes(viewKey)) {
    return { pinned: prefs.pinned, archived: prefs.archived.filter((k) => k !== viewKey) };
  }
  return {
    pinned: prefs.pinned.filter((k) => k !== viewKey),
    archived: [...prefs.archived, viewKey],
  };
}

/** Stable sort: pinned conversations first, in pin order; everything else keeps its order. */
export function orderPinnedFirst<T>(
  items: readonly T[],
  getViewKey: (item: T) => string,
  pinned: readonly string[],
): T[] {
  if (pinned.length === 0) return [...items];
  const rank = new Map(pinned.map((k, i) => [k, i]));
  const pinnedItems: { item: T; rank: number }[] = [];
  const rest: T[] = [];
  for (const item of items) {
    const r = rank.get(getViewKey(item));
    if (r == null) rest.push(item);
    else pinnedItems.push({ item, rank: r });
  }
  pinnedItems.sort((a, b) => a.rank - b.rank);
  return [...pinnedItems.map((p) => p.item), ...rest];
}

/**
 * Hide archived conversations unless `showArchived`. Views for which `keep` returns true (the
 * open conversation, or one with unread messages) are never hidden, so the user can still
 * unarchive the open one and does not miss new traffic.
 */
export function filterArchived<T>(
  items: readonly T[],
  getViewKey: (item: T) => string,
  archived: readonly string[],
  opts: { showArchived: boolean; keep?: (viewKey: string) => boolean },
): T[] {
  if (opts.showArchived || archived.length === 0) return [...items];
  const archivedSet = new Set(archived);
  return items.filter((item) => {
    const key = getViewKey(item);
    return !archivedSet.has(key) || opts.keep?.(key) === true;
  });
}
