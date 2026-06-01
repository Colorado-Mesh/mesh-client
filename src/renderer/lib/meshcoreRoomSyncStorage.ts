import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import { errLikeToLogString } from './errLikeToLogString';
import {
  getMeshcoreRoomCredential,
  listMeshcoreRoomCredentialNodeIds,
} from './meshcoreRoomCredentialStorage';
import { parseStoredJson } from './parseStoredJson';
import { MESHCORE_ROOM_SYNC_MIN_INTERVAL_MINUTES } from './timeConstants';

/** Per-room background sync + last-post metadata in app_settings. */
export const MESHCORE_ROOM_SYNC_SETTING_PREFIX = 'meshcoreRoomSync:';
export const MESHCORE_ROOM_LAST_POST_SETTING_PREFIX = 'meshcoreRoomLastPost:';

export interface MeshcoreRoomSyncConfig {
  enabled: boolean;
  intervalMinutes: number;
  lastSyncAt: number | null;
  /** When true, log in automatically on radio connect/reconnect (requires saved credentials). */
  autoLoginOnConnect?: boolean;
}

export function meshcoreRoomSyncSettingForNode(nodeId: number): string {
  return `${MESHCORE_ROOM_SYNC_SETTING_PREFIX}${String(nodeId >>> 0)}`;
}

export function meshcoreRoomLastPostSettingForNode(nodeId: number): string {
  return `${MESHCORE_ROOM_LAST_POST_SETTING_PREFIX}${String(nodeId >>> 0)}`;
}

function parseSyncConfig(raw: unknown): MeshcoreRoomSyncConfig | undefined {
  if (raw == null) return undefined;
  let o: Record<string, unknown>;
  if (typeof raw === 'string') {
    if (!raw.trim()) return undefined;
    try {
      o = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // catch-no-log-ok corrupt sync config JSON is ignored on read
      return undefined;
    }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    o = raw as Record<string, unknown>;
  } else {
    return undefined;
  }
  const enabled = o.enabled === true || o.enabled === 1 || o.enabled === '1';
  const intervalMinutes =
    typeof o.intervalMinutes === 'number' && Number.isFinite(o.intervalMinutes)
      ? Math.max(MESHCORE_ROOM_SYNC_MIN_INTERVAL_MINUTES, Math.trunc(o.intervalMinutes))
      : MESHCORE_ROOM_SYNC_MIN_INTERVAL_MINUTES;
  const lastSyncAt =
    typeof o.lastSyncAt === 'number' && Number.isFinite(o.lastSyncAt) ? o.lastSyncAt : null;
  const autoLoginOnConnect =
    o.autoLoginOnConnect === true || o.autoLoginOnConnect === 1 || o.autoLoginOnConnect === '1';
  return { enabled, intervalMinutes, lastSyncAt, autoLoginOnConnect };
}

export function getMeshcoreRoomSyncConfig(nodeId: number): MeshcoreRoomSyncConfig {
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshcoreRoomSyncStorage read sync',
  );
  const key = meshcoreRoomSyncSettingForNode(nodeId);
  const parsed = settings ? parseSyncConfig(settings[key]) : undefined;
  const hasSavedPassword = getMeshcoreRoomCredential(nodeId) != null;
  const autoLoginOnConnect = parsed?.autoLoginOnConnect ?? hasSavedPassword;
  return {
    enabled: parsed?.enabled ?? false,
    intervalMinutes: parsed?.intervalMinutes ?? MESHCORE_ROOM_SYNC_MIN_INTERVAL_MINUTES,
    lastSyncAt: parsed?.lastSyncAt ?? null,
    autoLoginOnConnect,
  };
}

export async function setMeshcoreRoomSyncConfig(
  nodeId: number,
  config: Pick<MeshcoreRoomSyncConfig, 'enabled' | 'intervalMinutes' | 'autoLoginOnConnect'>,
): Promise<MeshcoreRoomSyncConfig> {
  const prev = getMeshcoreRoomSyncConfig(nodeId);
  const next: MeshcoreRoomSyncConfig = {
    enabled: config.enabled,
    intervalMinutes: Math.max(
      MESHCORE_ROOM_SYNC_MIN_INTERVAL_MINUTES,
      Math.trunc(config.intervalMinutes),
    ),
    lastSyncAt: prev.lastSyncAt,
    autoLoginOnConnect: config.autoLoginOnConnect ?? prev.autoLoginOnConnect ?? false,
  };
  const settingKey = meshcoreRoomSyncSettingForNode(nodeId);
  const payload = JSON.stringify(next);
  mergeAppSetting(settingKey, payload, 'meshcoreRoomSyncStorage set');
  try {
    await window.electronAPI.appSettings.set(settingKey, payload);
  } catch (e: unknown) {
    console.warn('[meshcoreRoomSyncStorage] persist sync config failed ' + errLikeToLogString(e));
    throw e instanceof Error ? e : new Error(String(e));
  }
  return next;
}

export async function touchMeshcoreRoomLastSyncAt(nodeId: number, atMs: number): Promise<void> {
  const prev = getMeshcoreRoomSyncConfig(nodeId);
  const next: MeshcoreRoomSyncConfig = { ...prev, lastSyncAt: atMs };
  const settingKey = meshcoreRoomSyncSettingForNode(nodeId);
  const payload = JSON.stringify(next);
  mergeAppSetting(settingKey, payload, 'meshcoreRoomSyncStorage touch sync');
  try {
    await window.electronAPI.appSettings.set(settingKey, payload);
  } catch (e: unknown) {
    console.warn('[meshcoreRoomSyncStorage] touch lastSyncAt failed ' + errLikeToLogString(e));
  }
}

export function getMeshcoreRoomLastPostAt(nodeId: number): number | null {
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshcoreRoomSyncStorage read lastPost',
  );
  if (!settings) return null;
  const raw = settings[meshcoreRoomLastPostSettingForNode(nodeId)];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function setMeshcoreRoomLastPostAt(nodeId: number, atMs: number): Promise<void> {
  const prev = getMeshcoreRoomLastPostAt(nodeId);
  if (prev != null && atMs <= prev) return;
  const settingKey = meshcoreRoomLastPostSettingForNode(nodeId);
  mergeAppSetting(settingKey, atMs, 'meshcoreRoomSyncStorage lastPost');
  try {
    await window.electronAPI.appSettings.set(settingKey, String(atMs));
  } catch (e: unknown) {
    console.warn('[meshcoreRoomSyncStorage] persist lastPostAt failed ' + errLikeToLogString(e));
  }
}

export function listMeshcoreRoomSyncEnabledNodeIds(): number[] {
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshcoreRoomSyncStorage list enabled',
  );
  if (!settings) return [];
  const prefix = MESHCORE_ROOM_SYNC_SETTING_PREFIX;
  const ids: number[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(prefix)) continue;
    const cfg = parseSyncConfig(value);
    if (!cfg?.enabled) continue;
    const idStr = key.slice(prefix.length);
    const nodeId = Number.parseInt(idStr, 10);
    if (Number.isFinite(nodeId) && nodeId >= 0) ids.push(nodeId >>> 0);
  }
  return ids;
}

export function listMeshcoreRoomAutoLoginOnConnectNodeIds(): number[] {
  const ids = new Set<number>();
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshcoreRoomSyncStorage list autoLogin',
  );
  if (settings) {
    const prefix = MESHCORE_ROOM_SYNC_SETTING_PREFIX;
    for (const key of Object.keys(settings)) {
      if (!key.startsWith(prefix)) continue;
      const idStr = key.slice(prefix.length);
      const nodeId = Number.parseInt(idStr, 10);
      if (!Number.isFinite(nodeId) || nodeId < 0) continue;
      if (getMeshcoreRoomSyncConfig(nodeId >>> 0).autoLoginOnConnect) {
        ids.add(nodeId >>> 0);
      }
    }
  }
  for (const nodeId of listMeshcoreRoomCredentialNodeIds()) {
    if (getMeshcoreRoomSyncConfig(nodeId).autoLoginOnConnect) {
      ids.add(nodeId);
    }
  }
  return [...ids];
}
