import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';

export type MqttOnlyIdentitySource = 'lastRf' | 'virtual';

export const MESHTASTIC_LAST_RF_SELF_NODE_ID_KEY = 'meshtasticLastRfSelfNodeId';
export const MESHTASTIC_PREVIOUS_RF_SELF_NODE_IDS_KEY = 'meshtasticPreviousRfSelfNodeIds';
const MESHTASTIC_PREVIOUS_RF_SELF_NODE_IDS_MAX = 8;

/** Parse a stored last-RF node id; returns 0 when missing or out of range. */
export function parseLastRfSelfNodeIdRaw(raw: unknown): number {
  const nodeNum = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(nodeNum) || nodeNum <= 0 || nodeNum >= 0xffffffff) return 0;
  return nodeNum >>> 0;
}

/** MQTT-only sender: prefer last BLE node id when available, else persisted virtual id. */
export function resolveMqttOnlyFromNodeId(lastRfSelfNodeId: number, virtualNodeId: number): number {
  return lastRfSelfNodeId > 0 ? lastRfSelfNodeId : virtualNodeId;
}

export interface ResolveMeshtasticOutboundFromParams {
  hasDevice: boolean;
  myNodeNum: number;
  lastRfSelfNodeId: number;
  virtualNodeId: number;
}

/**
 * Outbound Meshtastic sender id for chat/MQTT publishes.
 * When a local radio is connected, never use the MQTT-only virtual id (avoids a brief
 * virtual `from` between deviceRef assignment and onMyNodeInfo).
 */
export function resolveMeshtasticOutboundFromNodeId(
  params: ResolveMeshtasticOutboundFromParams,
): number {
  const { hasDevice, myNodeNum, lastRfSelfNodeId, virtualNodeId } = params;
  if (!hasDevice) {
    return resolveMqttOnlyFromNodeId(lastRfSelfNodeId, virtualNodeId);
  }
  if (myNodeNum > 0 && myNodeNum !== virtualNodeId) {
    return myNodeNum;
  }
  if (lastRfSelfNodeId > 0) {
    return lastRfSelfNodeId;
  }
  return 0;
}

export function mqttOnlyIdentitySource(lastRfSelfNodeId: number): MqttOnlyIdentitySource {
  return lastRfSelfNodeId > 0 ? 'lastRf' : 'virtual';
}

/** Restore last RF node id from app settings (survives app restart for MQTT-only). */
export function loadPersistedLastRfSelfNodeId(): number {
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshtasticMqttIdentity loadPersistedLastRfSelfNodeId',
  );
  return parseLastRfSelfNodeIdRaw(settings?.[MESHTASTIC_LAST_RF_SELF_NODE_ID_KEY]);
}

/** Parse stored previous own node ids (JSON array or array); drops invalid entries. */
export function parsePreviousRfSelfNodeIdsRaw(raw: unknown): number[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      // catch-no-log-ok corrupt history is treated as empty
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const entry of value) {
    const nodeNum = parseLastRfSelfNodeIdRaw(entry);
    if (nodeNum > 0 && !out.includes(nodeNum)) out.push(nodeNum);
  }
  return out.slice(0, MESHTASTIC_PREVIOUS_RF_SELF_NODE_IDS_MAX);
}

/** Own node numbers this radio used before its current one (newest first). */
export function loadPreviousRfSelfNodeIds(): number[] {
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshtasticMqttIdentity loadPreviousRfSelfNodeIds',
  );
  return parsePreviousRfSelfNodeIdsRaw(settings?.[MESHTASTIC_PREVIOUS_RF_SELF_NODE_IDS_KEY]);
}

function persistPreviousRfSelfNodeIds(ids: number[]): void {
  const serialized = JSON.stringify(ids);
  mergeAppSetting(
    MESHTASTIC_PREVIOUS_RF_SELF_NODE_IDS_KEY,
    serialized,
    'meshtasticMqttIdentity persist previous',
  );
  void window.electronAPI.appSettings
    .set(MESHTASTIC_PREVIOUS_RF_SELF_NODE_IDS_KEY, serialized)
    .catch(() => {
      // catch-no-log-ok SQLite persist is best-effort; localStorage already updated
    });
}

/**
 * Persist last RF node id when a local radio reports myNodeNum. When the number changes
 * (firmware renumber), the prior id is kept in history so old messages still count as own.
 */
export function persistLastRfSelfNodeId(nodeNum: number): void {
  if (!Number.isFinite(nodeNum) || nodeNum <= 0) return;
  const normalized = nodeNum >>> 0;
  const previous = loadPersistedLastRfSelfNodeId();
  if (previous > 0 && previous !== normalized) {
    const history = [previous, ...loadPreviousRfSelfNodeIds()].filter((id) => id !== normalized);
    persistPreviousRfSelfNodeIds(parsePreviousRfSelfNodeIdsRaw(history));
  }
  mergeAppSetting(
    MESHTASTIC_LAST_RF_SELF_NODE_ID_KEY,
    String(normalized),
    'meshtasticMqttIdentity persist',
  );
  void window.electronAPI.appSettings
    .set(MESHTASTIC_LAST_RF_SELF_NODE_ID_KEY, String(normalized))
    .catch(() => {
      // catch-no-log-ok SQLite persist is best-effort; localStorage already updated
    });
}

/**
 * Chat "own message" ids for Meshtastic MQTT-only: active self id plus transition ids.
 * Excludes stale virtual id when last RF identity is in use.
 */
export function meshtasticMqttOwnNodeIds(
  selfNodeId: number,
  virtualNodeId: number,
  lastRfSelfNodeId: number,
  previousRfSelfNodeIds: readonly number[] = [],
): number[] {
  const ids = new Set<number>();
  if (selfNodeId > 0) ids.add(selfNodeId);
  if (lastRfSelfNodeId > 0) ids.add(lastRfSelfNodeId);
  for (const id of previousRfSelfNodeIds) {
    if (id > 0) ids.add(id);
  }
  if (virtualNodeId > 0 && lastRfSelfNodeId === 0) ids.add(virtualNodeId);
  return [...ids];
}

/**
 * Merge SQLite-backed last RF node id into localStorage on startup so MQTT-only
 * can use the real radio id after app restart.
 */
export async function hydrateLastRfSelfNodeIdFromAppSettings(): Promise<number> {
  try {
    const all = await window.electronAPI.appSettings.getAll();
    const nodeNum = parseLastRfSelfNodeIdRaw(all[MESHTASTIC_LAST_RF_SELF_NODE_ID_KEY]);
    if (nodeNum > 0) {
      mergeAppSetting(
        MESHTASTIC_LAST_RF_SELF_NODE_ID_KEY,
        String(nodeNum),
        'meshtasticMqttIdentity hydrate from SQLite',
      );
    }
  } catch {
    // catch-no-log-ok IPC unavailable during tests or early boot — localStorage may still have value
  }
  return loadPersistedLastRfSelfNodeId();
}
