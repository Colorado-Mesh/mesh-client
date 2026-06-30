import { chatViewKeyForMessage } from '@/renderer/lib/chatUnreadCounts';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { loadPersistedMeshcoreSelfNodeId } from './meshcoreLastSelfNodeId';
import { clampReadWatermarkMs, effectiveMessageTimestampMs } from './nodeStatus';
import { parseStoredJson } from './parseStoredJson';
import type { ChatMessage, MeshProtocol } from './types';

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

/**
 * Load persisted open DM tab node ids for this protocol.
 * Legacy unsuffixed keys predate dual-protocol storage — migrate into Meshtastic only
 * (MeshCore never wrote the legacy keys).
 */
export function loadOpenDmTabsInitial(protocol: MeshProtocol): number[] {
  const key = openDmTabsStorageKey(protocol);
  const normalizeTabId = (id: number): number => (protocol === 'reticulum' ? id >>> 0 : id);
  const normalizeList = (parsed: number[]): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const id of parsed) {
      if (typeof id !== 'number' || !Number.isFinite(id)) continue;
      const normalized = normalizeTabId(id);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  };
  const specific = localStorage.getItem(key);
  if (specific != null) {
    const parsed = parseStoredJson<unknown>(specific, 'ChatPanel openDmTabs');
    if (Array.isArray(parsed) && parsed.every((n: unknown) => typeof n === 'number')) {
      return normalizeList(parsed);
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
        return normalizeList(parsed);
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
    notifyMutedViewsChanged(protocol);
  } catch (e) {
    console.debug('[chatPanelProtocolStorage] saveMutedViews failed ' + errLikeToLogString(e));
  }
}

const mutedViewsSubscribers = new Set<(protocol: MeshProtocol) => void>();

export function notifyMutedViewsChanged(protocol: MeshProtocol): void {
  for (const cb of mutedViewsSubscribers) {
    cb(protocol);
  }
}

export function subscribeMutedViewsChanged(listener: (protocol: MeshProtocol) => void): () => void {
  mutedViewsSubscribers.add(listener);
  return () => {
    mutedViewsSubscribers.delete(listener);
  };
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

/**
 * Load persisted last-read map for this protocol.
 * Legacy unsuffixed keys predate dual-protocol storage — migrate into Meshtastic only.
 */
export function loadPersistedLastReadInitial(protocol: MeshProtocol): Record<string, number> {
  const key = lastReadStorageKey(protocol);
  const specificRaw = localStorage.getItem(key);
  let specific: Record<string, number> | null = null;
  if (specificRaw != null) {
    const parsed = parseStoredJson<Record<string, number>>(specificRaw, 'ChatPanel lastRead');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      specific = parsed;
    }
  }

  if (protocol === 'meshtastic') {
    const legacyRaw = localStorage.getItem(LEGACY_LAST_READ_KEY);
    let legacy: Record<string, number> | null = null;
    if (legacyRaw != null) {
      const parsed = parseStoredJson<Record<string, number>>(
        legacyRaw,
        'ChatPanel lastRead legacy',
      );
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        legacy = parsed;
      }
    }

    if (specific == null && legacy != null) {
      try {
        localStorage.setItem(key, legacyRaw!);
      } catch (e) {
        console.debug(
          '[chatPanelProtocolStorage] migrate lastRead to protocol key failed ' +
            errLikeToLogString(e),
        );
      }
      return legacy;
    }

    if (specific != null && legacy != null) {
      let merged: Record<string, number> | null = null;
      for (const legacyKey of new Set([...Object.keys(specific), ...Object.keys(legacy)])) {
        const specificValue = specific[legacyKey];
        const legacyValue = legacy[legacyKey];
        const specificNum =
          typeof specificValue === 'number' && Number.isFinite(specificValue) && specificValue > 0
            ? specificValue
            : 0;
        const legacyNum =
          typeof legacyValue === 'number' && Number.isFinite(legacyValue) && legacyValue > 0
            ? legacyValue
            : 0;
        const mergedValue = Math.max(specificNum, legacyNum);
        if (mergedValue <= 0) continue;
        const current =
          typeof specificValue === 'number' && Number.isFinite(specificValue) ? specificValue : 0;
        if (mergedValue !== current) {
          merged ??= { ...specific };
          merged[legacyKey] = mergedValue;
        }
      }
      if (merged != null) {
        try {
          localStorage.setItem(key, JSON.stringify(merged));
        } catch (e) {
          console.debug(
            '[chatPanelProtocolStorage] merge legacy lastRead into protocol key failed ' +
              errLikeToLogString(e),
          );
        }
        return merged;
      }
      return specific;
    }

    if (specific != null) return specific;
    return {};
  }

  if (specific != null) return specific;
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
const RETICULUM_LAST_READ_SANITIZED_KEY = 'mesh-client:lastReadSanitized:reticulum';

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

type ChatLastReadSanitizeMessage = Pick<ChatMessage, 'channel' | 'timestamp'> & {
  to?: number | null;
  sender_id?: number;
};

/** Max message timestamp per chat view key (`ch:N`, `dm:peer`). */
export function maxMessageTimestampByViewKey(
  messages: readonly ChatLastReadSanitizeMessage[],
  protocol: 'meshcore' | 'meshtastic' = 'meshtastic',
  ownNodeIds: ReadonlySet<number> = new Set(),
): Record<string, number> {
  const maxByKey: Record<string, number> = {};
  for (const msg of messages) {
    const key =
      msg.sender_id != null
        ? chatViewKeyForMessage(
            {
              channel: msg.channel,
              to: msg.to ?? undefined,
              sender_id: msg.sender_id,
            },
            protocol,
            ownNodeIds,
          )
        : msg.to != null
          ? `dm:${msg.to >>> 0}`
          : `ch:${msg.channel}`;
    const ts = effectiveMessageTimestampMs(msg.timestamp);
    const prev = maxByKey[key] ?? 0;
    if (ts > prev) maxByKey[key] = ts;
  }
  return maxByKey;
}

/**
 * Clamp MeshCore chat last-read watermarks that exceed device message times or client clock
 * (legacy pre-#490 Date.now() bumps suppressed sidebar badges).
 */
export function sanitizeMeshcoreChatLastRead(
  persisted: Readonly<Record<string, number>>,
  messages: readonly ChatLastReadSanitizeMessage[],
): Record<string, number> {
  const persistedSelf = loadPersistedMeshcoreSelfNodeId();
  const ownNodeIds = new Set(persistedSelf > 0 ? [persistedSelf] : []);
  const maxByKey = maxMessageTimestampByViewKey(messages, 'meshcore', ownNodeIds);
  const now = Date.now();
  let changed = false;
  const next: Record<string, number> = { ...persisted };
  for (const [key, watermark] of Object.entries(persisted)) {
    if (!key.startsWith('ch:') && !key.startsWith('dm:')) continue;
    const maxMsg = maxByKey[key] ?? 0;
    let clamped = clampReadWatermarkMs(watermark, now);
    if (watermark > now) clamped = maxMsg;
    else if (maxMsg > 0 && clamped > maxMsg) clamped = maxMsg;
    if (clamped !== watermark) {
      next[key] = clamped;
      changed = true;
    }
  }
  return changed ? next : persisted;
}

/** Clamp Meshtastic chat last-read watermarks that exceed message times or client clock. */
export function sanitizeMeshtasticChatLastRead(
  persisted: Readonly<Record<string, number>>,
  messages: readonly ChatLastReadSanitizeMessage[],
  ownNodeIds: ReadonlySet<number> = new Set(),
): Record<string, number> {
  const maxByKey = maxMessageTimestampByViewKey(messages, 'meshtastic', ownNodeIds);
  const now = Date.now();
  let changed = false;
  const next: Record<string, number> = { ...persisted };
  for (const [key, watermark] of Object.entries(persisted)) {
    if (!key.startsWith('ch:') && !key.startsWith('dm:')) continue;
    const maxMsg = maxByKey[key] ?? 0;
    let clamped = clampReadWatermarkMs(watermark, now);
    if (watermark > now) clamped = maxMsg;
    else if (maxMsg > 0 && clamped > maxMsg) clamped = maxMsg;
    if (clamped !== watermark) {
      next[key] = clamped;
      changed = true;
    }
  }
  return changed ? next : persisted;
}

/** Ongoing sanitize for Meshtastic chat lastRead (sidebar/tray badges). */
export function getSanitizedMeshtasticChatLastRead(
  messages: readonly ChatLastReadSanitizeMessage[],
  ownNodeIds: ReadonlySet<number>,
): Record<string, number> {
  return sanitizeMeshtasticChatLastRead(
    loadPersistedLastReadInitial('meshtastic'),
    messages,
    ownNodeIds,
  );
}

/** Ongoing sanitize for MeshCore chat lastRead (sidebar/tray badges). */
export function getSanitizedMeshcoreChatLastRead(
  messages: readonly ChatLastReadSanitizeMessage[],
): Record<string, number> {
  return sanitizeMeshcoreChatLastRead(loadPersistedLastReadInitial('meshcore'), messages);
}

/** Ongoing sanitize for Reticulum LXMF chat lastRead (sidebar/tray badges). */
export function getSanitizedReticulumChatLastRead(
  messages: readonly ChatLastReadSanitizeMessage[],
): Record<string, number> {
  return sanitizeMeshcoreChatLastRead(loadPersistedLastReadInitial('reticulum'), messages);
}

/** Persist MeshCore chat lastRead when sanitize adjusts watermarks (e.g. after upgrade). */
export function ensureMeshcoreChatLastReadSanitized(
  messages: readonly ChatLastReadSanitizeMessage[],
): Record<string, number> {
  const loaded = loadPersistedLastReadInitial('meshcore');
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

/** Persist Reticulum chat lastRead when sanitize adjusts watermarks (e.g. after upgrade). */
export function ensureReticulumChatLastReadSanitized(
  messages: readonly ChatLastReadSanitizeMessage[],
): Record<string, number> {
  const loaded = loadPersistedLastReadInitial('reticulum');
  const sanitized = sanitizeMeshcoreChatLastRead(loaded, messages);
  if (sanitized !== loaded) {
    try {
      localStorage.setItem(lastReadStorageKey('reticulum'), JSON.stringify(sanitized));
    } catch (e) {
      console.debug(
        '[chatPanelProtocolStorage] persist sanitized reticulum lastRead failed ' +
          errLikeToLogString(e),
      );
    }
  }
  try {
    localStorage.setItem(RETICULUM_LAST_READ_SANITIZED_KEY, '1');
  } catch (e) {
    console.debug(
      '[chatPanelProtocolStorage] set reticulum lastRead sanitized flag failed ' +
        errLikeToLogString(e),
    );
  }
  return sanitized;
}

/** Max clamped post timestamp per room server node id. */
export function maxRoomPostTimestampByServerId(
  messages: readonly { roomServerId?: number; timestamp: number }[],
): Record<number, number> {
  const maxById: Record<number, number> = {};
  for (const msg of messages) {
    if (msg.roomServerId == null) continue;
    const ts = effectiveMessageTimestampMs(msg.timestamp);
    const id = msg.roomServerId >>> 0;
    if (ts > (maxById[id] ?? 0)) maxById[id] = ts;
  }
  return maxById;
}

/** Clamp MeshCore room last-read watermarks that exceed post times or client clock. */
export function sanitizeMeshcoreRoomsLastRead(
  persisted: Readonly<Record<number, number>>,
  messages: readonly { roomServerId?: number; timestamp: number }[],
): Record<number, number> {
  const maxById = maxRoomPostTimestampByServerId(messages);
  const now = Date.now();
  let changed = false;
  const next: Record<number, number> = { ...persisted };
  for (const [k, watermark] of Object.entries(persisted)) {
    const nodeId = Number(k) >>> 0;
    if (!Number.isFinite(nodeId)) continue;
    const maxMsg = maxById[nodeId] ?? 0;
    let clamped = clampReadWatermarkMs(watermark, now);
    if (watermark > now) clamped = maxMsg;
    else if (maxMsg > 0 && clamped > maxMsg) clamped = maxMsg;
    if (clamped !== watermark) {
      next[nodeId] = clamped;
      changed = true;
    }
  }
  return changed ? next : persisted;
}

export function getSanitizedMeshcoreRoomsLastRead(
  messages: readonly { roomServerId?: number; timestamp: number }[],
): Record<number, number> {
  return sanitizeMeshcoreRoomsLastRead(loadPersistedRoomsLastRead(), messages);
}

export function clearPersistedLastReadForProtocol(protocol: MeshProtocol): void {
  try {
    localStorage.setItem(lastReadStorageKey(protocol), JSON.stringify({}));
    notifyPersistedLastReadChanged(protocol);
  } catch (e) {
    console.debug(
      '[chatPanelProtocolStorage] clearPersistedLastReadForProtocol failed ' +
        errLikeToLogString(e),
    );
  }
}

/** Remove last-read watermarks for a cleared channel (DM channel `-1` clears all `dm:` keys). */
export function removePersistedLastReadForChannel(protocol: MeshProtocol, channel: number): void {
  const loaded = loadPersistedLastReadInitial(protocol);
  const next =
    channel === -1
      ? Object.fromEntries(Object.entries(loaded).filter(([key]) => !key.startsWith('dm:')))
      : Object.fromEntries(Object.entries(loaded).filter(([key]) => key !== `ch:${channel}`));
  try {
    localStorage.setItem(lastReadStorageKey(protocol), JSON.stringify(next));
    notifyPersistedLastReadChanged(protocol);
  } catch (e) {
    console.debug(
      '[chatPanelProtocolStorage] removePersistedLastReadForChannel failed ' +
        errLikeToLogString(e),
    );
  }
}

export function clearPersistedRoomsLastRead(): void {
  savePersistedRoomsLastRead({});
}
