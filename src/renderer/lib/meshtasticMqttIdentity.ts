import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';

export type MqttOnlyIdentitySource = 'lastRf' | 'virtual';

export const MESHTASTIC_LAST_RF_SELF_NODE_ID_KEY = 'meshtasticLastRfSelfNodeId';

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
): number[] {
  const ids = new Set<number>();
  if (selfNodeId > 0) ids.add(selfNodeId);
  if (lastRfSelfNodeId > 0) ids.add(lastRfSelfNodeId);
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
