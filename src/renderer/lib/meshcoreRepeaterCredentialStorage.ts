import { MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX } from '@/shared/appSettingsKeyPrefixes';

import {
  createMeshcorePerNodeCredentialStorage,
  type MeshcorePerNodeCredentialStorage,
  parseLegacyCredentialRaw,
} from './meshcorePerNodeCredentialStorage';

interface MeshcoreRepeaterStoredCredential {
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
    securePrefix: 'meshcore:repeater:',
    parseValue: parseCredentialValue,
    serialize: (cred) => JSON.stringify({ password: cred.password }),
  });

export const readMeshcoreRepeaterCredentialMap = repeaterCredentialStorage.readMap;
export const getMeshcoreRepeaterCredential = repeaterCredentialStorage.get;
export const listMeshcoreRepeaterCredentialNodeIds = repeaterCredentialStorage.listNodeIds;
export const setMeshcoreRepeaterCredential = repeaterCredentialStorage.set;
