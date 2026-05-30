import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { parseStoredJson } from './parseStoredJson';
import type { MeshProtocol } from './types';

const LEGACY_OPEN_DM_TABS_KEY = 'mesh-client:openDmTabs';
const LEGACY_LAST_READ_KEY = 'mesh-client:lastRead';

export function openDmTabsStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:openDmTabs:${protocol}`;
}

export function lastReadStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:lastRead:${protocol}`;
}

export function dismissedDmTabsStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:dismissedDmTabs:${protocol}`;
}

/** Load persisted open DM tab node ids for this protocol; migrates legacy key into Meshtastic only. */
export function loadOpenDmTabsInitial(protocol: MeshProtocol): number[] {
  const key = openDmTabsStorageKey(protocol);
  const specific = localStorage.getItem(key);
  if (specific != null) {
    const parsed = parseStoredJson<unknown>(specific, 'ChatPanel openDmTabs');
    if (Array.isArray(parsed) && parsed.every((n: unknown) => typeof n === 'number')) {
      return parsed;
    }
  }
  if (protocol === 'meshtastic') {
    const legacy = localStorage.getItem(LEGACY_OPEN_DM_TABS_KEY);
    if (legacy != null) {
      const parsed = parseStoredJson<unknown>(legacy, 'ChatPanel openDmTabs legacy');
      if (Array.isArray(parsed) && parsed.every((n: unknown) => typeof n === 'number')) {
        try {
          localStorage.setItem(key, legacy);
        } catch (e) {
          console.debug(
            '[chatPanelProtocolStorage] migrate openDmTabs to protocol key failed ' +
              errLikeToLogString(e),
          );
        }
        return parsed;
      }
    }
  }
  return [];
}

export function draftsStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:drafts:${protocol}`;
}

/** Load persisted drafts (viewKey → text) for this protocol. */
export function loadDraftsInitial(protocol: MeshProtocol): Record<string, string> {
  const raw = localStorage.getItem(draftsStorageKey(protocol));
  if (raw == null) return {};
  const parsed = parseStoredJson<unknown>(raw, 'ChatPanel drafts');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') result[k] = v;
    }
    return result;
  }
  return {};
}

/** Save a draft for a specific view key. */
export function saveDraft(protocol: MeshProtocol, viewKey: string, text: string): void {
  try {
    const key = draftsStorageKey(protocol);
    const current = loadDraftsInitial(protocol);
    current[viewKey] = text;
    localStorage.setItem(key, JSON.stringify(current));
  } catch (e) {
    console.debug('[chatPanelProtocolStorage] saveDraft failed ' + errLikeToLogString(e));
  }
}

/** Remove the draft for a specific view key. */
export function clearDraft(protocol: MeshProtocol, viewKey: string): void {
  try {
    const key = draftsStorageKey(protocol);
    const current = loadDraftsInitial(protocol);
    const rest = Object.fromEntries(Object.entries(current).filter(([k]) => k !== viewKey));
    localStorage.setItem(key, JSON.stringify(rest));
  } catch (e) {
    console.debug('[chatPanelProtocolStorage] clearDraft failed ' + errLikeToLogString(e));
  }
}

/** Load muted view keys for this protocol (e.g. 'ch:0', 'dm:12345'). */
export function loadMutedViews(protocol: MeshProtocol): Set<string> {
  try {
    const raw = localStorage.getItem(`mesh-client:mutedViews:${protocol}`);
    if (!raw) return new Set();
    const parsed = parseStoredJson<unknown>(raw, 'ChatPanel mutedViews');
    if (Array.isArray(parsed) && parsed.every((v): v is string => typeof v === 'string')) {
      return new Set(parsed);
    }
  } catch (e) {
    console.debug('[chatPanelProtocolStorage] loadMutedViews failed ' + errLikeToLogString(e));
  }
  return new Set();
}

/** Persist muted view keys for this protocol. */
export function saveMutedViews(protocol: MeshProtocol, views: Set<string>): void {
  try {
    localStorage.setItem(`mesh-client:mutedViews:${protocol}`, JSON.stringify([...views]));
  } catch (e) {
    console.debug('[chatPanelProtocolStorage] saveMutedViews failed ' + errLikeToLogString(e));
  }
}

export interface StarredMessage {
  starId: string;
  timestamp: number;
  payload: string;
  sender_name: string;
  sender_id: number;
  viewKey: string;
  channel: number;
  to: number | null;
  starredAt: number;
}

const STARRED_LIMIT = 200;

/** Load starred messages for this protocol. */
export function loadStarred(protocol: MeshProtocol): StarredMessage[] {
  try {
    const raw = localStorage.getItem(`mesh-client:starred:${protocol}`);
    if (!raw) return [];
    const parsed = parseStoredJson<unknown>(raw, 'ChatPanel starred');
    if (Array.isArray(parsed)) return parsed as StarredMessage[];
  } catch (e) {
    console.debug('[chatPanelProtocolStorage] loadStarred failed ' + errLikeToLogString(e));
  }
  return [];
}

/** Persist starred messages for this protocol. Enforces STARRED_LIMIT by dropping oldest. */
export function saveStarred(protocol: MeshProtocol, items: StarredMessage[]): void {
  try {
    const capped =
      items.length > STARRED_LIMIT
        ? [...items].sort((a, b) => b.starredAt - a.starredAt).slice(0, STARRED_LIMIT)
        : items;
    localStorage.setItem(`mesh-client:starred:${protocol}`, JSON.stringify(capped));
  } catch (e) {
    console.debug('[chatPanelProtocolStorage] saveStarred failed ' + errLikeToLogString(e));
  }
}

/** Load persisted last-read map for this protocol; migrates legacy key into Meshtastic only. */
export function loadPersistedLastReadInitial(protocol: MeshProtocol): Record<string, number> {
  const key = lastReadStorageKey(protocol);
  const specific = localStorage.getItem(key);
  if (specific != null) {
    const parsed = parseStoredJson<Record<string, number>>(specific, 'ChatPanel lastRead');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  if (protocol === 'meshtastic') {
    const legacy = localStorage.getItem(LEGACY_LAST_READ_KEY);
    if (legacy != null) {
      const parsed = parseStoredJson<Record<string, number>>(legacy, 'ChatPanel lastRead legacy');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        try {
          localStorage.setItem(key, legacy);
        } catch (e) {
          console.debug(
            '[chatPanelProtocolStorage] migrate lastRead to protocol key failed ' +
              errLikeToLogString(e),
          );
        }
        return parsed;
      }
    }
  }
  return {};
}

const persistedLastReadSubscribers = new Set<(protocol: MeshProtocol) => void>();

/** Notify App (sidebar/tray) when ChatPanel advances a last-read watermark. */
export function notifyPersistedLastReadChanged(protocol: MeshProtocol): void {
  for (const cb of persistedLastReadSubscribers) {
    cb(protocol);
  }
}

export function subscribePersistedLastRead(listener: (protocol: MeshProtocol) => void): () => void {
  persistedLastReadSubscribers.add(listener);
  return () => {
    persistedLastReadSubscribers.delete(listener);
  };
}
