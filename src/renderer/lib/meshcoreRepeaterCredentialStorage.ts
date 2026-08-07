import { MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX } from '@/shared/appSettingsKeyPrefixes';

import {
  createMeshcorePerNodeCredentialStorage,
  type MeshcorePerNodeCredentialStorage,
  parseLegacyCredentialRaw,
} from './meshcorePerNodeCredentialStorage';

export { MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX };

export interface MeshcoreRepeaterStoredCredential {
  password: string;
}

function parseCredentialValue(raw: unknown): MeshcoreRepeaterStoredCredential | undefined {
  return parseLegacyCredentialRaw(raw, {
    fromPlainString: (value) => ({ password: value }),
    fromObject: (o) => {
      const password = typeof o.password === 'string' ? o.password : '';
      if (!password) return undefined;
      return { password };
    },
  });
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
