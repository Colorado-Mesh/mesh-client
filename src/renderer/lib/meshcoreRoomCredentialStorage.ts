import { MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX } from '@/shared/appSettingsKeyPrefixes';

import {
  createMeshcorePerNodeCredentialStorage,
  type MeshcorePerNodeCredentialStorage,
  parseLegacyCredentialRaw,
} from './meshcorePerNodeCredentialStorage';

export { MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX };

export interface MeshcoreRoomStoredCredential {
  /** Optional — admin-only records are allowed for Repeaters & Rooms ops. */
  guestPassword?: string;
  adminPassword?: string;
}

function parseCredentialValue(raw: unknown): MeshcoreRoomStoredCredential | undefined {
  return parseLegacyCredentialRaw<MeshcoreRoomStoredCredential>(raw, {
    fromPlainString: (value) => ({ guestPassword: value }),
    fromObject: (o) => {
      const hasExplicitGuestPassword = Object.prototype.hasOwnProperty.call(o, 'guestPassword');
      const storedGuestPassword =
        hasExplicitGuestPassword && typeof o.guestPassword === 'string' ? o.guestPassword : '';
      const legacyGuestPassword = typeof o.password === 'string' ? o.password : '';
      // Prefer explicit guestPassword (including "") over legacy password. Legacy empty
      // password alone is not a remembered blank credential.
      const guestPassword = hasExplicitGuestPassword ? storedGuestPassword : legacyGuestPassword;
      const adminRaw = typeof o.adminPassword === 'string' ? o.adminPassword.trim() : '';
      const adminPassword = adminRaw.length > 0 ? adminRaw : undefined;
      // Persist when guestPassword key was saved (including empty) or admin is non-empty.
      if (!hasExplicitGuestPassword && !guestPassword && !adminPassword) return undefined;
      const out: MeshcoreRoomStoredCredential = {};
      if (hasExplicitGuestPassword || guestPassword.length > 0) {
        out.guestPassword = guestPassword;
      }
      if (adminPassword != null) {
        out.adminPassword = adminPassword;
      }
      return out;
    },
  });
}

const roomCredentialStorage: MeshcorePerNodeCredentialStorage<MeshcoreRoomStoredCredential> =
  createMeshcorePerNodeCredentialStorage({
    prefix: MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX,
    logTag: 'meshcoreRoomCredentialStorage',
    parseValue: parseCredentialValue,
    serialize: (cred) => {
      const hasGuest = Object.prototype.hasOwnProperty.call(cred, 'guestPassword');
      return JSON.stringify({
        ...(hasGuest ? { guestPassword: cred.guestPassword ?? '' } : {}),
        ...(cred.adminPassword != null && cred.adminPassword.length > 0
          ? { adminPassword: cred.adminPassword }
          : {}),
      });
    },
  });
export function meshcoreRoomCredentialSettingForNode(nodeId: number): string {
  return roomCredentialStorage.settingKeyForNode(nodeId);
}

export const readMeshcoreRoomCredentialMap = roomCredentialStorage.readMap;
export const getMeshcoreRoomCredential = roomCredentialStorage.get;
export const listMeshcoreRoomCredentialNodeIds = roomCredentialStorage.listNodeIds;
export const setMeshcoreRoomCredential = roomCredentialStorage.set;
