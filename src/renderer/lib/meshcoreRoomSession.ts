import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { serializeMeshcoreUserMessage } from './meshcore/meshcoreMessageI18n';
import { resolveRoomAdminPassword } from './meshcoreInfraAdminSecrets';
import type { MeshcoreRadioConnection } from './meshcoreRepeaterRpcCommon';
import { meshcoreLoginErrorIsAuthFailure } from './meshcoreRepeaterRpcCommon';
import type { MeshcoreRepeaterRunSerialized } from './meshcoreRepeaterRpcQueuedSend';
import type { MeshcoreRepeaterLoginConn } from './meshcoreRepeaterSession';
import { assertMeshcoreRepeaterLoginOk, meshcoreRepeaterTryLogin } from './meshcoreRepeaterSession';
import {
  clearMeshcoreRoomLoginQueue,
  dequeueMeshcoreRoomLogin,
  enqueueMeshcoreRoomLogin,
  resetMeshcoreRoomLoginQueue,
} from './meshcoreRoomLoginQueue';
import { MESHCORE_ROOM_LOGIN_ABORT_MESSAGE, runMeshcoreRoomLogin } from './meshcoreRoomLoginRpc';
import { runMeshcoreRoomLogout } from './meshcoreRoomLogoutRpc';
import { getMeshcoreRoomLastPostAt } from './meshcoreRoomSyncStorage';
import {
  MESHCORE_ROOM_LOGIN_MAX_ATTEMPTS,
  MESHCORE_ROOM_LOGIN_RETRY_DELAY_MS,
  type MeshcoreCompanionTransport,
} from './timeConstants';
import type { DiagnosticTextI18n } from './types';

export { MESHCORE_ROOM_LOGIN_ABORT_MESSAGE };

/** MeshCore room ACL role inferred after login (firmware PERM_ACL_* low bits). */
export type MeshcoreRoomRole = 'none' | 'readonly' | 'readwrite' | 'admin';

export interface MeshcoreRoomSession {
  guestPassword: string;
  adminPassword: string;
  role: MeshcoreRoomRole;
  loggedInAt: number;
  /** Newest post timestamp synced from server (seconds, firmware clock). */
  syncSince?: number;
}

/** Minimal connection surface for room server login. */
export type MeshcoreRoomLoginConn = MeshcoreRadioConnection;

/** Firmware PERM_ACL_ROLE_MASK values (CommonCLI / room server ACL). */
export const MESHCORE_ROOM_PERM_GUEST = 0;
export const MESHCORE_ROOM_PERM_READ_WRITE = 2;
export const MESHCORE_ROOM_PERM_ADMIN = 3;

const sessions = new Map<number, MeshcoreRoomSession>();

type RoomSessionChangeListener = () => void;
const roomSessionChangeListeners = new Set<RoomSessionChangeListener>();

function notifyRoomSessionChanged(): void {
  for (const listener of roomSessionChangeListeners) {
    listener();
  }
}

/** Subscribe to room session map changes (login, logout, clear). Returns unsubscribe. */
export function subscribeMeshcoreRoomSessionChanges(cb: RoomSessionChangeListener): () => void {
  roomSessionChangeListeners.add(cb);
  return () => {
    roomSessionChangeListeners.delete(cb);
  };
}

/** Per-room login abort controllers (replaced on each new login for the same node). */
const roomLoginAbortControllers = new Map<number, AbortController>();

export function meshcoreIsRoomLoginAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.message === MESHCORE_ROOM_LOGIN_ABORT_MESSAGE;
}

export function meshcoreCancelRoomLogin(nodeId: number): void {
  roomLoginAbortControllers.get(nodeId)?.abort();
  dequeueMeshcoreRoomLogin(nodeId);
}

/** Abort the active login and drop all queued room logins. */
export function meshcoreCancelAllRoomLogins(): void {
  for (const controller of roomLoginAbortControllers.values()) {
    controller.abort();
  }
  clearMeshcoreRoomLoginQueue();
}

function throwIfRoomLoginAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException(MESHCORE_ROOM_LOGIN_ABORT_MESSAGE, 'AbortError');
  }
}

function beginRoomLoginAbortSignal(nodeId: number, externalSignal?: AbortSignal): AbortSignal {
  roomLoginAbortControllers.get(nodeId)?.abort();
  const controller = new AbortController();
  roomLoginAbortControllers.set(nodeId, controller);
  if (externalSignal?.aborted) {
    controller.abort();
  } else if (externalSignal) {
    externalSignal.addEventListener(
      'abort',
      () => {
        controller.abort();
      },
      { once: true },
    );
  }
  return controller.signal;
}

export function meshcoreGetRoomSession(nodeId: number): MeshcoreRoomSession | undefined {
  return sessions.get(nodeId);
}

export function meshcoreIsRoomLoggedIn(nodeId: number): boolean {
  const s = sessions.get(nodeId);
  return s != null && s.role !== 'none';
}

export function meshcoreRoomCanPost(nodeId: number): boolean {
  const s = sessions.get(nodeId);
  if (!s || s.role === 'none' || s.role === 'readonly') return false;
  return true;
}

export function meshcoreRoomCanAdmin(nodeId: number): boolean {
  return sessions.get(nodeId)?.role === 'admin';
}

/** Room ops CLI tokens that require an admin BBS session (guest/readwrite gets no reply). */
export function meshcoreRoomCliRequiresAdmin(command: string): boolean {
  const c = command.trim().toLowerCase();
  if (!c) return false;
  return c.startsWith('allow.read.only') || c.startsWith('setperm');
}

export function meshcoreClearAllRoomSessions(): void {
  for (const controller of roomLoginAbortControllers.values()) {
    controller.abort();
  }
  roomLoginAbortControllers.clear();
  resetMeshcoreRoomLoginQueue();
  sessions.clear();
  notifyRoomSessionChanged();
}

export function meshcoreClearRoomSession(nodeId: number): void {
  if (!sessions.has(nodeId)) return;
  sessions.delete(nodeId);
  notifyRoomSessionChanged();
}

function roleFromPermissionsByte(permissions: number): MeshcoreRoomRole {
  const roleBits = permissions & 0x03;
  if (roleBits === MESHCORE_ROOM_PERM_ADMIN) return 'admin';
  if (roleBits === MESHCORE_ROOM_PERM_READ_WRITE) return 'readwrite';
  if (roleBits === MESHCORE_ROOM_PERM_GUEST) return 'readonly';
  return 'readonly';
}

function roleFromPasswordHint(
  password: string,
  adminPassword: string,
  guestPassword: string,
): MeshcoreRoomRole {
  if (adminPassword.length > 0 && password === adminPassword) return 'admin';
  if (password.length === 0) return 'readonly';
  if (guestPassword.length > 0 && password === guestPassword) return 'readwrite';
  // Non-empty password that isn't stored admin — treat as guest/read-write attempt.
  return 'readwrite';
}

function parseLoginResponsePermissions(response: unknown): number | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;
  if (typeof r.permissions === 'number' && Number.isFinite(r.permissions)) {
    return r.permissions & 0xff;
  }
  return null;
}

export function meshcoreApplyRoomSession(
  nodeId: number,
  params: {
    guestPassword: string;
    adminPassword: string;
    role: MeshcoreRoomRole;
    syncSince?: number;
  },
): void {
  sessions.set(nodeId, {
    guestPassword: params.guestPassword,
    adminPassword: params.adminPassword,
    role: params.role,
    loggedInAt: Date.now(),
    syncSince: params.syncSince,
  });
  notifyRoomSessionChanged();
}

/** Default room guest password when firmware uses factory defaults (see MeshCore ROOM_PASSWORD). */
export const MESHCORE_ROOM_DEFAULT_GUEST_PASSWORD = 'hello';

/** Thrown when multi-hop login has no route bytes after resolve/trace. */
export const MESHCORE_ROOM_LOGIN_NO_ROUTE_MESSAGE = 'meshcore.errors.roomLogin.noRoute';

/** Thrown when companion path programming (addOrUpdateContact) fails before SendLogin. */
export const MESHCORE_ROOM_LOGIN_PATH_SYNC_FAILED_MESSAGE =
  'meshcore.errors.roomLogin.pathSyncFailed';

export function meshcoreRoomEffectiveGuestPassword(password: string): string {
  return password.trim() || MESHCORE_ROOM_DEFAULT_GUEST_PASSWORD;
}

/** True when Login sent the factory default guest password (empty field → hello). */
export function meshcoreRoomUsedDefaultGuestPassword(password: string): boolean {
  return password === MESHCORE_ROOM_DEFAULT_GUEST_PASSWORD;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function meshcoreRoomLoginErrorIsAuthFailure(err: unknown): boolean {
  return meshcoreLoginErrorIsAuthFailure(err);
}

export function meshcoreRoomLoginErrorIsNoRoute(err: unknown): boolean {
  return errLikeToLogString(err) === MESHCORE_ROOM_LOGIN_NO_ROUTE_MESSAGE;
}

export function meshcoreRoomLoginFailureMessage(
  err: unknown,
  password: string,
): DiagnosticTextI18n {
  const msg = errLikeToLogString(err).toLowerCase();
  if (meshcoreRoomLoginErrorIsAuthFailure(err)) {
    if (password.length === 0) {
      return { key: 'meshcore.errors.roomLogin.rejectedBlankGuest' };
    }
    if (meshcoreRoomUsedDefaultGuestPassword(password)) {
      return { key: 'meshcore.errors.roomLogin.rejectedDefaultGuest' };
    }
    return { key: 'meshcore.errors.roomLogin.rejectedCheckPassword' };
  }
  if (msg.includes('timeout') || msg.includes('loginRoom') || msg.includes('program the route')) {
    if (password.length === 0) {
      return { key: 'meshcore.errors.roomLogin.timedOutBlankGuest' };
    }
    if (meshcoreRoomUsedDefaultGuestPassword(password)) {
      return { key: 'meshcore.errors.roomLogin.timedOutDefaultGuest' };
    }
    return { key: 'meshcore.errors.roomLogin.timedOut' };
  }
  return { key: 'meshcore.errors.roomLogin.failed' };
}

/**
 * Login to a room server and store session state.
 * Failure point: radio timeout or wrong password — throws; caller shows UI error.
 */
export async function meshcoreRoomLogin(
  conn: MeshcoreRoomLoginConn,
  nodeId: number,
  pubKey: Uint8Array,
  password: string,
  opts?: {
    adminPassword?: string;
    guestPassword?: string;
    signal?: AbortSignal;
    hopsAway?: number;
    companionTransport?: MeshcoreCompanionTransport;
    /** When true, run SendLogin even if a session already exists (tryRelogin before post). */
    forceRelogin?: boolean;
  },
): Promise<void> {
  return enqueueMeshcoreRoomLogin(nodeId, async () => {
    if (meshcoreIsRoomLoggedIn(nodeId) && !opts?.forceRelogin) {
      return;
    }
    const signal = beginRoomLoginAbortSignal(nodeId, opts?.signal);
    const adminPassword = opts?.adminPassword ?? '';
    const guestPassword = opts?.guestPassword ?? password;
    let lastErr: unknown;
    try {
      for (let attempt = 1; attempt <= MESHCORE_ROOM_LOGIN_MAX_ATTEMPTS; attempt++) {
        throwIfRoomLoginAborted(signal);
        try {
          const response = await runMeshcoreRoomLogin(conn, pubKey, password, {
            hopsAway: opts?.hopsAway,
            companionTransport: opts?.companionTransport,
            signal,
          });
          throwIfRoomLoginAborted(signal);
          const permByte = parseLoginResponsePermissions(response);
          const role =
            permByte != null
              ? roleFromPermissionsByte(permByte)
              : roleFromPasswordHint(password, adminPassword, guestPassword);
          const lastPostMs = getMeshcoreRoomLastPostAt(nodeId);
          meshcoreApplyRoomSession(nodeId, {
            guestPassword,
            adminPassword,
            role,
            syncSince:
              lastPostMs != null && lastPostMs > 0 ? Math.floor(lastPostMs / 1000) : undefined,
          });
          return;
        } catch (e) {
          if (meshcoreIsRoomLoginAbortError(e)) throw e;
          lastErr = e;
          const errMsg = errLikeToLogString(e);
          if (attempt < MESHCORE_ROOM_LOGIN_MAX_ATTEMPTS) {
            console.warn(
              `[meshcoreRoomSession] room login attempt ${attempt}/${MESHCORE_ROOM_LOGIN_MAX_ATTEMPTS} failed ${errMsg}`,
            );
            throwIfRoomLoginAborted(signal);
            await sleepMs(MESHCORE_ROOM_LOGIN_RETRY_DELAY_MS);
          } else {
            console.warn('[meshcoreRoomSession] room login failed ' + errMsg);
          }
        }
      }
      throw new Error(
        serializeMeshcoreUserMessage(meshcoreRoomLoginFailureMessage(lastErr, password)),
      );
    } finally {
      if (roomLoginAbortControllers.get(nodeId)?.signal === signal) {
        roomLoginAbortControllers.delete(nodeId);
      }
    }
  });
}

/** Minimal connection surface for room server logout. */
export type MeshcoreRoomLogoutConn = MeshcoreRadioConnection;

export function meshcoreRoomLogoutFailureMessage(err: unknown): DiagnosticTextI18n {
  const msg = errLikeToLogString(err).toLowerCase();
  if (msg.includes('timeout')) {
    return { key: 'meshcore.errors.roomLogout.timedOut' };
  }
  if (msg.includes('rejected')) {
    return { key: 'meshcore.errors.roomLogout.rejected' };
  }
  return { key: 'meshcore.errors.roomLogout.failed' };
}

/**
 * Logout from a room server and clear local session on success.
 * Failure point: radio timeout or Err — throws; caller shows UI error; session kept.
 */
export async function meshcoreRoomLogout(
  conn: MeshcoreRoomLogoutConn,
  nodeId: number,
  pubKey: Uint8Array,
  opts?: {
    companionTransport?: MeshcoreCompanionTransport;
  },
): Promise<void> {
  await runMeshcoreRoomLogout(conn, pubKey, opts);
  meshcoreClearRoomSession(nodeId);
}

/** Best-effort re-login using stored session passwords (e.g. before post or admin CLI). */
export async function meshcoreRoomTryRelogin(
  conn: MeshcoreRoomLoginConn,
  nodeId: number,
  pubKey: Uint8Array,
  mode: 'post' | 'admin',
  opts?: {
    hopsAway?: number;
    companionTransport?: MeshcoreCompanionTransport;
  },
): Promise<boolean> {
  const session = sessions.get(nodeId);
  if (!session) return false;
  // Admin mode must use the ops/session admin password — never fall back to guest.
  // A guest-only "success" would skip meshcoreRoomTryAdminLogin and block CLI.
  const adminPassword =
    mode === 'admin'
      ? resolveRoomAdminPassword(nodeId, session.adminPassword)
      : session.adminPassword;
  const password = mode === 'admin' ? adminPassword : session.guestPassword;
  if (!password.trim()) return false;
  const ok = await meshcoreRoomLogin(conn, nodeId, pubKey, password, {
    adminPassword: adminPassword || session.adminPassword,
    guestPassword: session.guestPassword,
    hopsAway: opts?.hopsAway,
    companionTransport: opts?.companionTransport,
    forceRelogin: true,
  }).then(
    () => true,
    () => false,
  );
  if (!ok) return false;
  const roleOk = mode === 'admin' ? meshcoreRoomCanAdmin(nodeId) : meshcoreRoomCanPost(nodeId);
  return roleOk;
}

export function meshcoreRoomEnsureLoggedIn(nodeId: number, mode: 'post' | 'admin'): boolean {
  if (!meshcoreIsRoomLoggedIn(nodeId)) return false;
  if (mode === 'admin') return meshcoreRoomCanAdmin(nodeId);
  return meshcoreRoomCanPost(nodeId);
}

/** Best-effort admin login before room server status/telemetry/CLI. */
export async function meshcoreRoomTryAdminLogin(
  conn: MeshcoreRoomLoginConn,
  nodeId: number,
  pubKey: Uint8Array,
  opts?: {
    hopsAway?: number;
    companionTransport?: MeshcoreCompanionTransport;
  },
): Promise<void> {
  const session = sessions.get(nodeId);
  const adminPassword = resolveRoomAdminPassword(nodeId, session?.adminPassword);
  const guestPassword = session?.guestPassword.trim() ?? '';
  const password = adminPassword || guestPassword;
  if (!password) return;
  await meshcoreRoomLogin(conn, nodeId, pubKey, password, {
    adminPassword: adminPassword || session?.adminPassword || '',
    guestPassword: guestPassword || session?.guestPassword || '',
    forceRelogin: session != null && session.role !== 'admin',
    hopsAway: opts?.hopsAway,
    companionTransport: opts?.companionTransport,
  });
}

/** Repeater admin login or room server admin login depending on contact type. */
export type MeshcoreRemoteServerLoginConn = MeshcoreRepeaterLoginConn;

export async function meshcoreTryRemoteServerLogin(
  conn: MeshcoreRemoteServerLoginConn,
  nodeId: number,
  pubKey: Uint8Array,
  hwModel: string | undefined,
  runSerialized?: MeshcoreRepeaterRunSerialized,
): Promise<void> {
  if (hwModel === 'Room') {
    // Keep an existing BBS session (including guest/readwrite). forceRelogin with a
    // distinct ops admin password often times out on firmwares that omit LoginFail.
    if (meshcoreIsRoomLoggedIn(nodeId)) return;
    await meshcoreRoomTryAdminLogin(conn, nodeId, pubKey);
    return;
  }
  const login = await meshcoreRepeaterTryLogin(conn, pubKey, nodeId, runSerialized);
  assertMeshcoreRepeaterLoginOk(login);
}
