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

const MESHCORE_LAST_READ_SANITIZED_KEY = 'mesh-client:lastReadSanitized:meshcore';

export function roomsLastReadStorageKey(): string {
  return 'mesh-client:roomsLastRead:meshcore';
}

/** Load persisted last-seen post timestamp per room server node id. */
export function loadPersistedRoomsLastRead(): Record<number, number> {
  try {
    const raw = localStorage.getItem(roomsLastReadStorageKey());
    if (!raw) return {};
    const parsed = parseStoredJson<Record<string, number>>(raw, 'RoomsPanel lastRead');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const nodeId = Number(k);
      if (Number.isFinite(nodeId) && typeof v === 'number' && v > 0) {
        result[nodeId >>> 0] = v;
      }
    }
    return result;
  } catch (e) {
    console.debug(
      '[chatPanelProtocolStorage] loadPersistedRoomsLastRead failed ' + errLikeToLogString(e),
    );
  }
  return {};
}

export function savePersistedRoomsLastRead(lastRead: Record<number, number>): void {
  try {
    const serialized: Record<string, number> = {};
    for (const [nodeId, ts] of Object.entries(lastRead)) {
      if (ts > 0) serialized[nodeId] = ts;
    }
    localStorage.setItem(roomsLastReadStorageKey(), JSON.stringify(serialized));
  } catch (e) {
    console.debug(
      '[chatPanelProtocolStorage] savePersistedRoomsLastRead failed ' + errLikeToLogString(e),
    );
  }
}

export function mergeRoomLastReadWatermark(
  prev: Record<number, number>,
  roomNodeId: number,
  timestamp: number,
): Record<number, number> {
  if (timestamp <= 0) return prev;
  const existing = prev[roomNodeId] ?? 0;
  if (existing >= timestamp) return prev;
  return { ...prev, [roomNodeId]: timestamp };
}

const roomsLastReadSubscribers = new Set<() => void>();

export function notifyPersistedRoomsLastReadChanged(): void {
  for (const cb of roomsLastReadSubscribers) {
    cb();
  }
}

export function subscribePersistedRoomsLastRead(listener: () => void): () => void {
  roomsLastReadSubscribers.add(listener);
  return () => {
    roomsLastReadSubscribers.delete(listener);
  };
}

/** Max message timestamp per chat view key (`ch:N`, `dm:peer`). */
export function maxMessageTimestampByViewKey(
  messages: readonly { channel: number; to?: number | null; timestamp: number }[],
): Record<string, number> {
  const maxByKey: Record<string, number> = {};
  for (const msg of messages) {
    const key = msg.to != null ? `dm:${msg.to >>> 0}` : `ch:${msg.channel}`;
    const prev = maxByKey[key] ?? 0;
    if (msg.timestamp > prev) maxByKey[key] = msg.timestamp;
  }
  return maxByKey;
}

/**
 * Clamp MeshCore chat last-read watermarks that exceed device message times or client clock
 * (legacy pre-#490 Date.now() bumps suppressed sidebar badges).
 */
export function sanitizeMeshcoreChatLastRead(
  persisted: Readonly<Record<string, number>>,
  messages: readonly { channel: number; to?: number | null; timestamp: number }[],
): Record<string, number> {
  const maxByKey = maxMessageTimestampByViewKey(messages);
  const now = Date.now();
  let changed = false;
  const next: Record<string, number> = { ...persisted };
  for (const [key, watermark] of Object.entries(persisted)) {
    if (!key.startsWith('ch:') && !key.startsWith('dm:')) continue;
    const maxMsg = maxByKey[key] ?? 0;
    let clamped = watermark;
    if (watermark > now) clamped = maxMsg;
    else if (maxMsg > 0 && watermark > maxMsg) clamped = maxMsg;
    if (clamped !== watermark) {
      next[key] = clamped;
      changed = true;
    }
  }
  return changed ? next : persisted;
}

/** One-time sanitize MeshCore chat lastRead after upgrade; persists when adjusted. */
export function ensureMeshcoreChatLastReadSanitized(
  messages: readonly { channel: number; to?: number | null; timestamp: number }[],
): Record<string, number> {
  const loaded = loadPersistedLastReadInitial('meshcore');
  if (localStorage.getItem(MESHCORE_LAST_READ_SANITIZED_KEY) === '1') {
    return loaded;
  }
  const sanitized = sanitizeMeshcoreChatLastRead(loaded, messages);
  if (sanitized !== loaded) {
    try {
      localStorage.setItem(lastReadStorageKey('meshcore'), JSON.stringify(sanitized));
    } catch (e) {
      console.debug(
        '[chatPanelProtocolStorage] persist sanitized meshcore lastRead failed ' +
          errLikeToLogString(e),
      );
    }
  }
  try {
    localStorage.setItem(MESHCORE_LAST_READ_SANITIZED_KEY, '1');
  } catch (e) {
    console.debug(
      '[chatPanelProtocolStorage] set meshcore lastRead sanitized flag failed ' +
        errLikeToLogString(e),
    );
  }
  return sanitized;
}
