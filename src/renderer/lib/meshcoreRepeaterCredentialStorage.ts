import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import { errLikeToLogString } from './errLikeToLogString';
import { parseStoredJson } from './parseStoredJson';

/** Per-repeater admin passwords in app_settings (local SQLite via IPC). */
export const MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX = 'meshcoreRepeaterCredential:';

export interface MeshcoreRepeaterStoredCredential {
  password: string;
}

export function meshcoreRepeaterCredentialSettingForNode(nodeId: number): string {
  return `${MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX}${String(nodeId >>> 0)}`;
}

function parseCredentialValue(raw: unknown): MeshcoreRepeaterStoredCredential | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    if (!raw.trim()) return undefined;
    try {
      return parseCredentialValue(JSON.parse(raw) as unknown);
    } catch {
      // catch-no-log-ok legacy plain-string credential is not JSON
      return { password: raw };
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const password = typeof o.password === 'string' ? o.password : '';
  if (!password) return undefined;
  return { password };
}

export function readMeshcoreRepeaterCredentialMap(): Map<number, MeshcoreRepeaterStoredCredential> {
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshcoreRepeaterCredentialStorage read',
  );
  const out = new Map<number, MeshcoreRepeaterStoredCredential>();
  if (!settings) return out;
  const prefix = MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX;
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

export function getMeshcoreRepeaterCredential(
  nodeId: number,
): MeshcoreRepeaterStoredCredential | undefined {
  return readMeshcoreRepeaterCredentialMap().get(nodeId >>> 0);
}

export function listMeshcoreRepeaterCredentialNodeIds(): number[] {
  return [...readMeshcoreRepeaterCredentialMap().keys()];
}

export async function setMeshcoreRepeaterCredential(
  nodeId: number,
  cred: MeshcoreRepeaterStoredCredential | null,
): Promise<void> {
  const settingKey = meshcoreRepeaterCredentialSettingForNode(nodeId);
  const payload = cred == null ? '' : JSON.stringify({ password: cred.password });
  mergeAppSetting(settingKey, payload, 'meshcoreRepeaterCredentialStorage set');
  try {
    await window.electronAPI.appSettings.set(settingKey, payload);
  } catch (e: unknown) {
    console.warn('[meshcoreRepeaterCredentialStorage] persist failed ' + errLikeToLogString(e));
    throw e instanceof Error ? e : new Error(String(e));
  }
}
