import {
  createMeshcorePerNodeCredentialStorage,
  type MeshcorePerNodeCredentialStorage,
} from './meshcorePerNodeCredentialStorage';

/** Per-repeater admin passwords in app_settings (local SQLite via IPC). */
export const MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX = 'meshcoreRepeaterCredential:';

export interface MeshcoreRepeaterStoredCredential {
  password: string;
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

const repeaterCredentialStorage: MeshcorePerNodeCredentialStorage<MeshcoreRepeaterStoredCredential> =
  createMeshcorePerNodeCredentialStorage({
    prefix: MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX,
    logTag: 'meshcoreRepeaterCredentialStorage',
    parseValue: parseCredentialValue,
    serialize: (cred) => JSON.stringify({ password: cred.password }),
  });

export function meshcoreRepeaterCredentialSettingForNode(nodeId: number): string {
  return repeaterCredentialStorage.settingKeyForNode(nodeId);
}

export const readMeshcoreRepeaterCredentialMap = repeaterCredentialStorage.readMap;
export const getMeshcoreRepeaterCredential = repeaterCredentialStorage.get;
export const listMeshcoreRepeaterCredentialNodeIds = repeaterCredentialStorage.listNodeIds;
export const setMeshcoreRepeaterCredential = repeaterCredentialStorage.set;
