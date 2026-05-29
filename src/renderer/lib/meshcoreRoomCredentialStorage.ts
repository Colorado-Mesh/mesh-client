import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import { errLikeToLogString } from './errLikeToLogString';
import { parseStoredJson } from './parseStoredJson';

/** Per-room guest/admin passwords in app_settings (local SQLite via IPC). */
export const MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX = 'meshcoreRoomCredential:';

export interface MeshcoreRoomStoredCredential {
  guestPassword: string;
  adminPassword?: string;
}

export function meshcoreRoomCredentialSettingForNode(nodeId: number): string {
  return `${MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX}${String(nodeId >>> 0)}`;
}

function parseCredentialValue(raw: unknown): MeshcoreRoomStoredCredential | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    if (!raw.trim()) return undefined;
    try {
      return parseCredentialValue(JSON.parse(raw) as unknown);
    } catch {
      // catch-no-log-ok legacy plain-string credential is not JSON
      return { guestPassword: raw };
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const guestPassword = typeof o.guestPassword === 'string' ? o.guestPassword : '';
  if (!guestPassword && typeof o.password === 'string') {
    return { guestPassword: o.password };
  }
  if (!guestPassword) return undefined;
  const adminPassword = typeof o.adminPassword === 'string' ? o.adminPassword : undefined;
  return { guestPassword, adminPassword };
}

export function readMeshcoreRoomCredentialMap(): Map<number, MeshcoreRoomStoredCredential> {
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshcoreRoomCredentialStorage read',
  );
  const out = new Map<number, MeshcoreRoomStoredCredential>();
  if (!settings) return out;
  const prefix = MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX;
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(prefix)) continue;
    const idStr = key.slice(prefix.length);
    const nodeId = Number.parseInt(idStr, 10);
    if (!Number.isFinite(nodeId) || nodeId < 0) continue;
    const cred = parseCredentialValue(value);
    if (cred) out.set(nodeId >>> 0, cred);
  }
  return out;
}

export function getMeshcoreRoomCredential(
  nodeId: number,
): MeshcoreRoomStoredCredential | undefined {
  return readMeshcoreRoomCredentialMap().get(nodeId >>> 0);
}

export function listMeshcoreRoomCredentialNodeIds(): number[] {
  return [...readMeshcoreRoomCredentialMap().keys()];
}

export async function setMeshcoreRoomCredential(
  nodeId: number,
  cred: MeshcoreRoomStoredCredential | null,
): Promise<void> {
  const settingKey = meshcoreRoomCredentialSettingForNode(nodeId);
  const payload =
    cred == null
      ? ''
      : JSON.stringify({
          guestPassword: cred.guestPassword,
          ...(cred.adminPassword != null && cred.adminPassword.length > 0
            ? { adminPassword: cred.adminPassword }
            : {}),
        });
  mergeAppSetting(settingKey, payload, 'meshcoreRoomCredentialStorage set');
  try {
    await window.electronAPI.appSettings.set(settingKey, payload);
  } catch (e: unknown) {
    console.warn('[meshcoreRoomCredentialStorage] persist failed ' + errLikeToLogString(e));
    throw e instanceof Error ? e : new Error(String(e));
  }
}
