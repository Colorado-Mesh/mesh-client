import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { normalizeMeshcoreFloodScopeHashtag } from '@/renderer/lib/meshcoreFloodScope';
import { isValidMeshcoreFloodScopeHashtag } from '@/renderer/lib/meshcoreFloodScopePresetsStorage';

import {
  type ChatLastReadSanitizeMessage,
  maxMessageTimestampByViewKey,
  maxRoomPostTimestampByServerId,
  sanitizeNumericKeyLastRead,
  sanitizeViewKeyLastRead,
} from './chatLastReadSanitize';
import { loadPersistedMeshcoreSelfNodeId } from './meshcoreLastSelfNodeId';
import { parseStoredJson } from './parseStoredJson';
import type { MeshProtocol } from './types';

/** Cap persisted flood-scope override map size (view keys). */
const FLOOD_SCOPE_OVERRIDE_MAX_KEYS = 200;

export {
  type ChatLastReadSanitizeMessage,
  maxMessageTimestampByViewKey,
  maxRoomPostTimestampByServerId,
} from './chatLastReadSanitize';

const LEGACY_OPEN_DM_TABS_KEY = 'mesh-client:openDmTabs';
const LEGACY_LAST_READ_KEY = 'mesh-client:lastRead';

export function openDmTabsStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:openDmTabs:${protocol}`;
}

export function activeDmStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:activeDm:${protocol}`;
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

/**
 * Last-focused DM node id for this protocol (null if missing/invalid).
 * Reticulum normalizes with `>>> 0` like open tabs.
 */
export function loadActiveDmInitial(protocol: MeshProtocol): number | null {
  const key = activeDmStorageKey(protocol);
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === '') return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return protocol === 'reticulum' ? parsed >>> 0 : parsed;
  } catch (e) {
    console.debug('[chatPanelProtocolStorage] loadActiveDmInitial failed ' + errLikeToLogString(e));
    return null;
  }
}

/** Persist last-focused DM; pass null to clear. */
export function saveActiveDm(protocol: MeshProtocol, nodeId: number | null): void {
  const key = activeDmStorageKey(protocol);
  try {
    if (nodeId == null) {
      localStorage.removeItem(key);
      return;
    }
    const normalized = protocol === 'reticulum' ? nodeId >>> 0 : nodeId;
    localStorage.setItem(key, String(normalized));
  } catch (e) {
    console.debug('[chatPanelProtocolStorage] saveActiveDm failed ' + errLikeToLogString(e));
  }
}

/**
 * Scoped by the connected device's own node number (not just protocol) so that
 * switching to a genuinely different physical node — which can reuse the same
 * internal identity slot as the node just disconnected from — doesn't restore a
 * channel selection that belonged to the previous device. A same-node
 * disconnect/reconnect keeps the same node number, so the prior selection is
 * still found and restored; a different node simply misses and falls back to
 * the default channel.
 */
export function activeChannelStorageKey(protocol: MeshProtocol, nodeNum: number): string {
  return `mesh-client:activeChannel:${protocol}:${nodeNum}`;
}

/**
 * ChatPanel uses channel index -1 as the "primary" sentinel (MeshCore); every
 * other valid index is >= 0. Reject anything else, including other negatives.
 */
function isValidChannelIndex(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= -1;
}

/** Node numbers are always positive integers; reject fractional/infinite input. */
function isValidNodeNum(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Last-selected channel index for this protocol + node (null if missing/invalid). */
export function loadActiveChannelInitial(protocol: MeshProtocol, nodeNum: number): number | null {
  if (!isValidNodeNum(nodeNum)) return null;
  try {
    const raw = localStorage.getItem(activeChannelStorageKey(protocol, nodeNum));
    if (raw == null || raw.trim() === '') return null;
    const parsed = Number(raw);
    if (!isValidChannelIndex(parsed)) return null;
    return parsed;
  } catch (e) {
    console.debug(
      '[chatPanelProtocolStorage] loadActiveChannelInitial failed ' + errLikeToLogString(e),
    );
    return null;
  }
}

/** Persist last-selected channel index for this protocol + node. No-op without a node number. */
export function saveActiveChannel(
  protocol: MeshProtocol,
  nodeNum: number,
  channelIndex: number,
): void {
  if (!isValidNodeNum(nodeNum)) return;
  if (!isValidChannelIndex(channelIndex)) return;
  try {
    localStorage.setItem(activeChannelStorageKey(protocol, nodeNum), String(channelIndex));
  } catch (e) {
    console.debug('[chatPanelProtocolStorage] saveActiveChannel failed ' + errLikeToLogString(e));
  }
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

/**
 * Chat composer sentinel: explicitly Unscoped (mesh-wide), distinct from Default (`''`).
 * Must round-trip through flood-scope override storage unchanged.
 */
export const FLOOD_SCOPE_OVERRIDE_UNSCOPED = '__unscoped__';

export function floodScopeOverridesStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:floodScopeOverrides:${protocol}`;
}

/** True when a stored override is Unscoped or a valid named hashtag (not Default). */
function isPersistedFloodScopeOverride(value: string): boolean {
  if (value === FLOOD_SCOPE_OVERRIDE_UNSCOPED) return true;
  return isValidMeshcoreFloodScopeHashtag(normalizeMeshcoreFloodScopeHashtag(value));
}

function normalizePersistedFloodScopeOverride(value: string): string | null {
  if (value === FLOOD_SCOPE_OVERRIDE_UNSCOPED) return FLOOD_SCOPE_OVERRIDE_UNSCOPED;
  const normalized = normalizeMeshcoreFloodScopeHashtag(value);
  return isValidMeshcoreFloodScopeHashtag(normalized) ? normalized : null;
}

/** Load persisted Chat flood-scope overrides (viewKey → override) for this protocol. */
export function loadFloodScopeOverridesInitial(protocol: MeshProtocol): Record<string, string> {
  const raw = localStorage.getItem(floodScopeOverridesStorageKey(protocol));
  if (raw == null) return {};
  const parsed = parseStoredJson<unknown>(raw, 'ChatPanel floodScopeOverrides');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'string') continue;
      const normalized = normalizePersistedFloodScopeOverride(v);
      if (!normalized) continue;
      result[k] = normalized;
      if (Object.keys(result).length >= FLOOD_SCOPE_OVERRIDE_MAX_KEYS) break;
    }
    return result;
  }
  return {};
}

/**
 * Persist a flood-scope override for a view key.
 * Default (`''`) clears the key so it is distinct from Unscoped.
 */
export function saveFloodScopeOverride(
  protocol: MeshProtocol,
  viewKey: string,
  override: string,
): void {
  try {
    const key = floodScopeOverridesStorageKey(protocol);
    const current = loadFloodScopeOverridesInitial(protocol);
    if (!override || !isPersistedFloodScopeOverride(override)) {
      const rest = Object.fromEntries(Object.entries(current).filter(([k]) => k !== viewKey));
      localStorage.setItem(key, JSON.stringify(rest));
      return;
    }
    const normalized = normalizePersistedFloodScopeOverride(override);
    if (!normalized) {
      const rest = Object.fromEntries(Object.entries(current).filter(([k]) => k !== viewKey));
      localStorage.setItem(key, JSON.stringify(rest));
      return;
    }
    current[viewKey] = normalized;
    const entries = Object.entries(current);
    if (entries.length > FLOOD_SCOPE_OVERRIDE_MAX_KEYS) {
      const trimmed = Object.fromEntries(entries.slice(-FLOOD_SCOPE_OVERRIDE_MAX_KEYS));
      localStorage.setItem(key, JSON.stringify(trimmed));
      return;
    }
    localStorage.setItem(key, JSON.stringify(current));
  } catch (e) {
    console.debug(
      '[chatPanelProtocolStorage] saveFloodScopeOverride failed ' + errLikeToLogString(e),
    );
  }
}

/** Remove the flood-scope override for a specific view key (back to Default). */
export function clearFloodScopeOverride(protocol: MeshProtocol, viewKey: string): void {
  saveFloodScopeOverride(protocol, viewKey, '');
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

function isStarredMessage(value: unknown): value is StarredMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.starId === 'string' &&
    typeof v.timestamp === 'number' &&
    Number.isFinite(v.timestamp) &&
    typeof v.payload === 'string' &&
    typeof v.sender_name === 'string' &&
    typeof v.sender_id === 'number' &&
    Number.isFinite(v.sender_id) &&
    typeof v.viewKey === 'string' &&
    typeof v.channel === 'number' &&
    Number.isFinite(v.channel) &&
    (v.to === null || (typeof v.to === 'number' && Number.isFinite(v.to))) &&
    typeof v.starredAt === 'number' &&
    Number.isFinite(v.starredAt)
  );
}

const STARRED_LIMIT = 200;

/** Load starred messages for this protocol. */
export function loadStarred(protocol: MeshProtocol): StarredMessage[] {
  try {
    const raw = localStorage.getItem(`mesh-client:starred:${protocol}`);
    if (!raw) return [];
    const parsed = parseStoredJson<unknown>(raw, 'ChatPanel starred');
    if (Array.isArray(parsed)) return parsed.filter(isStarredMessage);
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
  return sanitizeViewKeyLastRead(persisted, maxByKey);
}

/** Clamp Meshtastic chat last-read watermarks that exceed message times or client clock. */
export function sanitizeMeshtasticChatLastRead(
  persisted: Readonly<Record<string, number>>,
  messages: readonly ChatLastReadSanitizeMessage[],
  ownNodeIds: ReadonlySet<number> = new Set(),
): Record<string, number> {
  const maxByKey = maxMessageTimestampByViewKey(messages, 'meshtastic', ownNodeIds);
  return sanitizeViewKeyLastRead(persisted, maxByKey);
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

/** Clamp Reticulum LXMF chat last-read watermarks that exceed message times or client clock. */
export function sanitizeReticulumChatLastRead(
  persisted: Readonly<Record<string, number>>,
  messages: readonly ChatLastReadSanitizeMessage[],
  ownNodeIds: ReadonlySet<number> = new Set(),
): Record<string, number> {
  const maxByKey = maxMessageTimestampByViewKey(messages, 'reticulum', ownNodeIds);
  return sanitizeViewKeyLastRead(persisted, maxByKey);
}

/** Ongoing sanitize for Reticulum LXMF chat lastRead (sidebar/tray badges). */
export function getSanitizedReticulumChatLastRead(
  messages: readonly ChatLastReadSanitizeMessage[],
  ownNodeIds: ReadonlySet<number>,
): Record<string, number> {
  return sanitizeReticulumChatLastRead(
    loadPersistedLastReadInitial('reticulum'),
    messages,
    ownNodeIds,
  );
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
  ownNodeIds: ReadonlySet<number>,
): Record<string, number> {
  const loaded = loadPersistedLastReadInitial('reticulum');
  const sanitized = sanitizeReticulumChatLastRead(loaded, messages, ownNodeIds);
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

/** Clamp MeshCore room last-read watermarks that exceed post times or client clock. */
export function sanitizeMeshcoreRoomsLastRead(
  persisted: Readonly<Record<number, number>>,
  messages: readonly { roomServerId?: number; timestamp: number }[],
): Record<number, number> {
  const maxById = maxRoomPostTimestampByServerId(messages);
  return sanitizeNumericKeyLastRead(persisted, maxById);
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
  notifyPersistedRoomsLastReadChanged();
}
