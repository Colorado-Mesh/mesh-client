import { errLikeToLogString } from './errLikeToLogString';
import {
  clearMeshcoreRoomAutoLoginFailure,
  setMeshcoreRoomAutoLoginFailure,
} from './meshcoreRoomAutoLoginFailure';
import {
  getMeshcoreRoomCredential,
  setMeshcoreRoomCredential,
} from './meshcoreRoomCredentialStorage';
import {
  meshcoreIsRoomLoginAbortError,
  meshcoreRoomLoginErrorIsAuthFailure,
} from './meshcoreRoomSession';
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
export async function disableMeshcoreRoomAutoLogin(
  nodeId: number,
  opts?: { clearFailure?: boolean },
): Promise<void> {
  const prev = getMeshcoreRoomSyncConfig(nodeId);
  await setMeshcoreRoomSyncConfig(nodeId, {
    enabled: prev.enabled,
    intervalMinutes: prev.intervalMinutes,
    autoLoginOnConnect: false,
  });
  if (opts?.clearFailure !== false) {
    clearMeshcoreRoomAutoLoginFailure(nodeId);
  }
}

/**
 * Wrong-password / ACL failure: turn off auto-login and periodic sync but keep stored password.
 * Does not clear in-memory auto-login failure (caller sets that for UI).
 */
export async function disableMeshcoreRoomLoginAfterAuthFailure(nodeId: number): Promise<void> {
  const prev = getMeshcoreRoomSyncConfig(nodeId);
  await setMeshcoreRoomSyncConfig(nodeId, {
    enabled: false,
    intervalMinutes: prev.intervalMinutes,
    autoLoginOnConnect: false,
  });
}

/**
 * Shared login failure handler: on auth failure disable sync/auto-login (keep password);
 * always record in-memory failure for UI unless the login was aborted.
 */
export async function applyMeshcoreRoomLoginFailure(
  nodeId: number,
  error: unknown,
  logContext: string,
): Promise<void> {
  if (meshcoreIsRoomLoginAbortError(error)) return;
  const msg = error instanceof Error ? error.message : String(error);
  if (meshcoreRoomLoginErrorIsAuthFailure(error)) {
    try {
      await disableMeshcoreRoomLoginAfterAuthFailure(nodeId);
    } catch (persistErr: unknown) {
      console.warn(
        `[${logContext}] disable room sync after auth failure failed ` +
          errLikeToLogString(persistErr),
      );
    }
  }
  setMeshcoreRoomAutoLoginFailure(nodeId, msg || 'timeout');
}
