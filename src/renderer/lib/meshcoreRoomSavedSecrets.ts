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
  meshcoreGetRoomSession,
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

/**
 * Saves the logged-in session's passwords when none are saved for the room. Connect-time
 * auto-login only runs for rooms with a saved password, so turning it on must keep one.
 * Returns true when it saved a new credential.
 */
export async function saveMeshcoreRoomSessionPasswordIfUnsaved(nodeId: number): Promise<boolean> {
  if (getMeshcoreRoomCredential(nodeId) != null) return false;
  const session = meshcoreGetRoomSession(nodeId);
  if (!session) return false;
  await setMeshcoreRoomCredential(nodeId, {
    guestPassword: session.guestPassword,
    ...(session.adminPassword.length > 0 ? { adminPassword: session.adminPassword } : {}),
  });
  return true;
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
 * Shared login failure handler: on auth failure disable sync/auto-login (keep password) and
 * sticky-skip further connect auto-login; transient errors keep sync/auto-login enabled and only
 * surface an in-memory UI failure (reconnect / next trigger may retry).
 */
export async function applyMeshcoreRoomLoginFailure(
  nodeId: number,
  error: unknown,
  logContext: string,
): Promise<void> {
  if (meshcoreIsRoomLoginAbortError(error)) return;
  const msg = error instanceof Error ? error.message : String(error);
  const isAuth = meshcoreRoomLoginErrorIsAuthFailure(error);
  if (isAuth) {
    try {
      await disableMeshcoreRoomLoginAfterAuthFailure(nodeId);
    } catch (persistErr: unknown) {
      console.warn(
        `[${logContext}] disable room sync after auth failure failed ` +
          errLikeToLogString(persistErr),
      );
    }
  }
  setMeshcoreRoomAutoLoginFailure(nodeId, msg || 'timeout', { stickySkip: isAuth });
}
