import {
  createMeshcorePerNodeCredentialStorage,
  type MeshcorePerNodeCredentialStorage,
  parseLegacyCredentialRaw,
} from './meshcorePerNodeCredentialStorage';

/** Per-room guest/admin passwords in app_settings (local SQLite via IPC). */
export const MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX = 'meshcoreRoomCredential:';

export interface MeshcoreRoomStoredCredential {
  guestPassword: string;
  adminPassword?: string;
}

function parseCredentialValue(raw: unknown): MeshcoreRoomStoredCredential | undefined {
  return parseLegacyCredentialRaw(raw, {
    fromPlainString: (value) => ({ guestPassword: value }),
    fromObject: (o) => {
      const guestPassword = typeof o.guestPassword === 'string' ? o.guestPassword : '';
      if (!guestPassword && typeof o.password === 'string') {
        return { guestPassword: o.password };
      }
      if (!guestPassword) return undefined;
      const adminPassword = typeof o.adminPassword === 'string' ? o.adminPassword : undefined;
      return { guestPassword, adminPassword };
    },
  });
}

const roomCredentialStorage: MeshcorePerNodeCredentialStorage<MeshcoreRoomStoredCredential> =
  createMeshcorePerNodeCredentialStorage({
    prefix: MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX,
    logTag: 'meshcoreRoomCredentialStorage',
    parseValue: parseCredentialValue,
    serialize: (cred) =>
      JSON.stringify({
        guestPassword: cred.guestPassword,
        ...(cred.adminPassword != null && cred.adminPassword.length > 0
          ? { adminPassword: cred.adminPassword }
          : {}),
      }),
  });

export function meshcoreRoomCredentialSettingForNode(nodeId: number): string {
  return roomCredentialStorage.settingKeyForNode(nodeId);
}

export const readMeshcoreRoomCredentialMap = roomCredentialStorage.readMap;
export const getMeshcoreRoomCredential = roomCredentialStorage.get;
export const listMeshcoreRoomCredentialNodeIds = roomCredentialStorage.listNodeIds;
export const setMeshcoreRoomCredential = roomCredentialStorage.set;
