import { create } from 'zustand';

import type { IdentityId } from '@/renderer/lib/types';
import type { ReachCheckErrorCode, ReachCheckSession } from '@/shared/reachCheck';

/**
 * In-memory reach check results, keyed like `relayCoverageStore` (`identityId:messageId`) so the
 * results line can sit under the sent code's bubble. Not persisted: results do not survive a
 * restart (the server's results page keeps them).
 */
export interface ReachCheckEntry {
  /** Server origin the session belongs to (`https://host`). */
  origin: string;
  sessionId: string;
  code: string;
  /** Latest session answer, or null before the first one. */
  session: ReachCheckSession | null;
  /** polling: still updating; finished: code expired or used up; gone: server forgot it. */
  state: 'polling' | 'finished' | 'gone' | 'error';
  error?: ReachCheckErrorCode;
  startedAt: number;
}

/** Oldest entries (by start time) are dropped beyond this many. */
export const REACH_CHECK_SOFT_CAP = 64;

interface ReachCheckState {
  entries: Record<string, ReachCheckEntry>;
  start: (identityId: IdentityId, messageId: string, entry: ReachCheckEntry) => void;
  update: (key: string, patch: Partial<ReachCheckEntry>) => void;
  entryFor: (identityId: IdentityId, messageId: string) => ReachCheckEntry | undefined;
  keyForSession: (sessionId: string) => string | undefined;
  renameMessage: (identityId: IdentityId, fromMessageId: string, toMessageId: string) => void;
  clearIdentity: (identityId: IdentityId) => void;
  remove: (key: string) => void;
}

export function reachCheckKey(identityId: IdentityId, messageId: string): string {
  return `${identityId}:${messageId}`;
}

function withoutKeys(
  entries: Record<string, ReachCheckEntry>,
  drop: (key: string) => boolean,
): Record<string, ReachCheckEntry> {
  const next: Record<string, ReachCheckEntry> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!drop(key)) next[key] = value;
  }
  return next;
}

function capEntries(
  entries: Record<string, ReachCheckEntry>,
  keepKey: string,
): Record<string, ReachCheckEntry> {
  const keys = Object.keys(entries);
  if (keys.length <= REACH_CHECK_SOFT_CAP) return entries;
  const oldest = keys
    .filter((key) => key !== keepKey)
    .sort((a, b) => entries[a].startedAt - entries[b].startedAt)
    .slice(0, keys.length - REACH_CHECK_SOFT_CAP);
  const drop = new Set(oldest);
  return withoutKeys(entries, (key) => drop.has(key));
}

export const useReachCheckStore = create<ReachCheckState>()((set, get) => ({
  entries: {},
  start: (identityId, messageId, entry) => {
    const key = reachCheckKey(identityId, messageId);
    set((s) => ({ entries: capEntries({ ...s.entries, [key]: entry }, key) }));
  },
  update: (key, patch) => {
    set((s) => {
      if (!Object.hasOwn(s.entries, key)) return s;
      return { entries: { ...s.entries, [key]: { ...s.entries[key], ...patch } } };
    });
  },
  entryFor: (identityId, messageId) => get().entries[reachCheckKey(identityId, messageId)],
  keyForSession: (sessionId) =>
    Object.keys(get().entries).find((key) => get().entries[key].sessionId === sessionId),
  renameMessage: (identityId, fromMessageId, toMessageId) => {
    if (fromMessageId === toMessageId) return;
    set((s) => {
      const fromKey = reachCheckKey(identityId, fromMessageId);
      if (!Object.hasOwn(s.entries, fromKey)) return s;
      const moved = s.entries[fromKey];
      const rest = withoutKeys(s.entries, (key) => key === fromKey);
      return { entries: { ...rest, [reachCheckKey(identityId, toMessageId)]: moved } };
    });
  },
  clearIdentity: (identityId) => {
    const prefix = `${identityId}:`;
    set((s) => ({ entries: withoutKeys(s.entries, (key) => key.startsWith(prefix)) }));
  },
  remove: (key) => {
    set((s) => ({ entries: withoutKeys(s.entries, (k) => k === key) }));
  },
}));
