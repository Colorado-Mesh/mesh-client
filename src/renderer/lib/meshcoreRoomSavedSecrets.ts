import { clearMeshcoreRoomAutoLoginFailure } from './meshcoreRoomAutoLoginFailure';
import {
  getMeshcoreRoomCredential,
  setMeshcoreRoomCredential,
} from './meshcoreRoomCredentialStorage';
import { getMeshcoreRoomSyncConfig, setMeshcoreRoomSyncConfig } from './meshcoreRoomSyncStorage';

export interface MeshcoreRoomSavedSecretsSummary {
  hasCredential: boolean;
  autoLoginOnConnect: boolean;
  syncEnabled: boolean;
}

export function getMeshcoreRoomSavedSecretsSummary(
  nodeId: number,
): MeshcoreRoomSavedSecretsSummary {
  const cred = getMeshcoreRoomCredential(nodeId);
  const cfg = getMeshcoreRoomSyncConfig(nodeId);
  return {
    hasCredential: cred != null,
    autoLoginOnConnect: cfg.autoLoginOnConnect ?? false,
    syncEnabled: cfg.enabled,
  };
}

/** Clears saved password and disables auto-login + periodic auto-sync for a room. */
export async function forgetMeshcoreRoomSavedSecrets(nodeId: number): Promise<void> {
  const prev = getMeshcoreRoomSyncConfig(nodeId);
  await setMeshcoreRoomCredential(nodeId, null);
  await setMeshcoreRoomSyncConfig(nodeId, {
    enabled: false,
    intervalMinutes: prev.intervalMinutes,
    autoLoginOnConnect: false,
  });
  clearMeshcoreRoomAutoLoginFailure(nodeId);
}

/** Keeps saved password but stops connect-time auto-login. */
export async function disableMeshcoreRoomAutoLogin(nodeId: number): Promise<void> {
  const prev = getMeshcoreRoomSyncConfig(nodeId);
  await setMeshcoreRoomSyncConfig(nodeId, {
    enabled: prev.enabled,
    intervalMinutes: prev.intervalMinutes,
    autoLoginOnConnect: false,
  });
  clearMeshcoreRoomAutoLoginFailure(nodeId);
}
