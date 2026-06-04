import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import type { MeshcoreRepeaterLoginConn } from './meshcoreRepeaterSession';
import { meshcoreRepeaterTryLogin } from './meshcoreRepeaterSession';
import {
  clearMeshcoreRoomLoginQueue,
  dequeueMeshcoreRoomLogin,
  enqueueMeshcoreRoomLogin,
  resetMeshcoreRoomLoginQueue,
} from './meshcoreRoomLoginQueue';
import {
  MESHCORE_ROOM_LOGIN_ABORT_MESSAGE,
  type MeshcoreRoomLoginRpcConnection,
  runMeshcoreRoomLogin,
} from './meshcoreRoomLoginRpc';
import {
  type MeshcoreRoomLogoutRpcConnection,
  runMeshcoreRoomLogout,
} from './meshcoreRoomLogoutRpc';
import { getMeshcoreRoomLastPostAt } from './meshcoreRoomSyncStorage';
import {
  MESHCORE_ROOM_LOGIN_MAX_ATTEMPTS,
  MESHCORE_ROOM_LOGIN_RETRY_DELAY_MS,
  type MeshcoreCompanionTransport,
} from './timeConstants';

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
export type MeshcoreRoomLoginConn = MeshcoreRoomLoginRpcConnection;

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
export const MESHCORE_ROOM_LOGIN_NO_ROUTE_MESSAGE =
  'No route to this room server. Trace the node from the map or wait for path adverts, then try again.';

/** Thrown when companion path programming (addOrUpdateContact) fails before SendLogin. */
export const MESHCORE_ROOM_LOGIN_PATH_SYNC_FAILED_MESSAGE =
  'Could not program the route on your radio before login. Reconnect the device and try again.';

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
  const msg = errLikeToLogString(err).toLowerCase();
  return msg.includes('rejected') || msg.includes('wrong password') || msg.includes('acl denied');
}

export function meshcoreRoomLoginFailureMessage(err: unknown, password: string): string {
  const msg = errLikeToLogString(err).toLowerCase();
  if (meshcoreRoomLoginErrorIsAuthFailure(err)) {
    if (password.length === 0) {
      return 'Room login rejected. Use Continue read-only for blank guest password, or try guest password "hello".';
    }
    if (meshcoreRoomUsedDefaultGuestPassword(password)) {
      return 'Room login rejected. If this server has no guest password, use Continue read-only instead of Login. Otherwise check the guest or admin password.';
    }
    return 'Room login rejected. Check the guest or admin password for this room server.';
  }
  if (msg.includes('timeout') || msg.includes('loginRoom') || msg.includes('program the route')) {
    if (password.length === 0) {
      return 'Room login timed out. Use Continue read-only for blank guest password, or try guest password "hello".';
    }
    if (meshcoreRoomUsedDefaultGuestPassword(password)) {
      return 'Room login timed out. If this server has no guest password, use Continue read-only instead of Login.';
    }
    return 'Room login timed out. The room may be out of range or not responding.';
  }
  return 'Room login failed';
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
      throw new Error(meshcoreRoomLoginFailureMessage(lastErr, password));
    } finally {
      if (roomLoginAbortControllers.get(nodeId)?.signal === signal) {
        roomLoginAbortControllers.delete(nodeId);
      }
    }
  });
}

/** Minimal connection surface for room server logout. */
export type MeshcoreRoomLogoutConn = MeshcoreRoomLogoutRpcConnection;

export function meshcoreRoomLogoutFailureMessage(err: unknown): string {
  const msg = errLikeToLogString(err).toLowerCase();
  if (msg.includes('timeout')) {
    return 'Room logout timed out. The room may be out of range or not responding.';
  }
  if (msg.includes('rejected')) {
    return 'Room logout rejected by radio.';
  }
  return 'Could not leave room';
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
  const password =
    mode === 'admin' && session.adminPassword.length > 0
      ? session.adminPassword
      : session.guestPassword;
  return meshcoreRoomLogin(conn, nodeId, pubKey, password, {
    adminPassword: session.adminPassword,
    guestPassword: session.guestPassword,
    hopsAway: opts?.hopsAway,
    companionTransport: opts?.companionTransport,
    forceRelogin: true,
  }).then(
    () => true,
    () => false,
  );
}

export function meshcoreRoomEnsureLoggedIn(nodeId: number, mode: 'post' | 'admin'): boolean {
  if (!meshcoreIsRoomLoggedIn(nodeId)) return false;
  if (mode === 'admin') return meshcoreRoomCanAdmin(nodeId);
  return meshcoreRoomCanPost(nodeId);
}

/** Best-effort admin login before room server status/telemetry/CLI (uses session admin password). */
export async function meshcoreRoomTryAdminLogin(
  conn: MeshcoreRoomLoginConn,
  nodeId: number,
  pubKey: Uint8Array,
): Promise<void> {
  const session = sessions.get(nodeId);
  if (!session) return;
  const password = session.adminPassword.trim() || session.guestPassword.trim();
  if (!password) return;
  await meshcoreRoomLogin(conn, nodeId, pubKey, password, {
    adminPassword: session.adminPassword,
    guestPassword: session.guestPassword,
  });
}

/** Repeater admin login or room server admin login depending on contact type. */
export type MeshcoreRemoteServerLoginConn = MeshcoreRepeaterLoginConn & MeshcoreRoomLoginConn;

export async function meshcoreTryRemoteServerLogin(
  conn: MeshcoreRemoteServerLoginConn,
  nodeId: number,
  pubKey: Uint8Array,
  hwModel: string | undefined,
): Promise<void> {
  if (hwModel === 'Room') {
    await meshcoreRoomTryAdminLogin(conn, nodeId, pubKey);
    return;
  }
  await meshcoreRepeaterTryLogin(conn, pubKey);
}
