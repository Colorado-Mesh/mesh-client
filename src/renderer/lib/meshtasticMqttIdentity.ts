import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';

export type MqttOnlyIdentitySource = 'lastRf' | 'virtual';

export const MESHTASTIC_LAST_RF_SELF_NODE_ID_KEY = 'meshtasticLastRfSelfNodeId';
export const MESHTASTIC_OWN_NODE_NUMS_BY_PUBLIC_KEY_KEY = 'meshtasticOwnNodeNumsByPublicKey';
const MESHTASTIC_OWN_NODE_NUMS_PER_KEY_MAX = 8;
const PUBLIC_KEY_HEX_RE = /^[0-9a-f]{64}$/;
const ZERO_PUBLIC_KEY_HEX = '0'.repeat(64);

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

type OwnNodeNumsByPublicKey = Record<string, number[]>;

/** Parse the stored own-node history (JSON or object); drops invalid keys and node numbers. */
export function parseOwnNodeNumsByPublicKeyRaw(raw: unknown): OwnNodeNumsByPublicKey {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      // catch-no-log-ok corrupt history is treated as empty
      return {};
    }
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: OwnNodeNumsByPublicKey = {};
  for (const [key, nums] of Object.entries(value as Record<string, unknown>)) {
    if (!PUBLIC_KEY_HEX_RE.test(key) || !Array.isArray(nums)) continue;
    const parsed: number[] = [];
    for (const entry of nums) {
      const nodeNum = parseLastRfSelfNodeIdRaw(entry);
      if (nodeNum > 0 && !parsed.includes(nodeNum)) parsed.push(nodeNum);
    }
    if (parsed.length > 0) out[key] = parsed.slice(0, MESHTASTIC_OWN_NODE_NUMS_PER_KEY_MAX);
  }
  return out;
}

function loadOwnNodeNumsByPublicKey(): OwnNodeNumsByPublicKey {
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshtasticMqttIdentity loadOwnNodeNumsByPublicKey',
  );
  return parseOwnNodeNumsByPublicKeyRaw(settings?.[MESHTASTIC_OWN_NODE_NUMS_BY_PUBLIC_KEY_KEY]);
}

/**
 * Node numbers the local radio with this public key has used (newest first). Firmware 2.8
 * renumbers a radio without changing its key, so this links its old and new numbers
 * without mixing in other radios.
 */
export function loadOwnNodeNumsForPublicKey(publicKeyHex: string | undefined): number[] {
  const key = publicKeyHex?.toLowerCase();
  if (!key || !PUBLIC_KEY_HEX_RE.test(key)) return [];
  return loadOwnNodeNumsByPublicKey()[key] ?? [];
}

/** Remember that the connected radio with this public key reported `nodeNum` as its own. */
export function recordOwnMeshtasticNodeNum(
  publicKeyHex: string | undefined,
  nodeNum: number,
): void {
  const key = publicKeyHex?.toLowerCase();
  const normalized = parseLastRfSelfNodeIdRaw(nodeNum);
  if (!key || !PUBLIC_KEY_HEX_RE.test(key) || key === ZERO_PUBLIC_KEY_HEX || normalized === 0) {
    return;
  }
  const history = loadOwnNodeNumsByPublicKey();
  const existing = history[key] ?? [];
  if (existing[0] === normalized) return;
  const next = parseOwnNodeNumsByPublicKeyRaw({
    ...history,
    [key]: [normalized, ...existing.filter((id) => id !== normalized)],
  });
  const serialized = JSON.stringify(next);
  mergeAppSetting(
    MESHTASTIC_OWN_NODE_NUMS_BY_PUBLIC_KEY_KEY,
    serialized,
    'meshtasticMqttIdentity record own node num',
  );
  void window.electronAPI.appSettings
    .set(MESHTASTIC_OWN_NODE_NUMS_BY_PUBLIC_KEY_KEY, serialized)
    .catch(() => {
      // catch-no-log-ok SQLite persist is best-effort; localStorage already updated
    });
}

/** Persist last RF node id when a local radio reports myNodeNum. */
export function persistLastRfSelfNodeId(nodeNum: number): void {
  if (!Number.isFinite(nodeNum) || nodeNum <= 0) return;
  const normalized = nodeNum >>> 0;
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
  ownNodeNumsForSelfKey: readonly number[] = [],
): number[] {
  const ids = new Set<number>();
  if (selfNodeId > 0) ids.add(selfNodeId);
  if (lastRfSelfNodeId > 0) ids.add(lastRfSelfNodeId);
  for (const id of ownNodeNumsForSelfKey) {
    if (id > 0) ids.add(id);
  }
  if (virtualNodeId > 0 && lastRfSelfNodeId === 0) ids.add(virtualNodeId);
  return [...ids];
}

/**
 * Merge SQLite-backed last RF node id and own-node history into localStorage on startup
 * so MQTT-only can use the real radio id after app restart.
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
    const stored = parseOwnNodeNumsByPublicKeyRaw(all[MESHTASTIC_OWN_NODE_NUMS_BY_PUBLIC_KEY_KEY]);
    if (Object.keys(stored).length > 0) {
      const local = loadOwnNodeNumsByPublicKey();
      const merged: OwnNodeNumsByPublicKey = { ...stored };
      for (const [key, nums] of Object.entries(local)) {
        merged[key] = [...nums, ...(stored[key] ?? []).filter((id) => !nums.includes(id))];
      }
      mergeAppSetting(
        MESHTASTIC_OWN_NODE_NUMS_BY_PUBLIC_KEY_KEY,
        JSON.stringify(parseOwnNodeNumsByPublicKeyRaw(merged)),
        'meshtasticMqttIdentity hydrate own node history from SQLite',
      );
    }
  } catch {
    // catch-no-log-ok IPC unavailable during tests or early boot — localStorage may still have value
  }
  return loadPersistedLastRfSelfNodeId();
}
