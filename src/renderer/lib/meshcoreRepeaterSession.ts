import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { MESHCORE_TELEMETRY_TIMEOUT_MS } from '../hooks/meshcore/meshcoreHookPreamble';
import { getMeshcoreRepeaterCredential } from './meshcoreRepeaterCredentialStorage';
import { runMeshcoreRepeaterLogin } from './meshcoreRepeaterLoginRpc';
import {
  meshcoreLoginErrorIsAuthFailure,
  type MeshcoreRadioConnection,
} from './meshcoreRepeaterRpcCommon';
import type { MeshcoreRepeaterRunSerialized } from './meshcoreRepeaterRpcQueuedSend';
import { awaitMeshcoreRepeaterAdminRfIdle } from './meshcoreTraceRadioIdle';

/** Minimal connection surface for repeater admin login RPC. */
export type MeshcoreRepeaterLoginConn = MeshcoreRadioConnection;

/** Session-only passwords keyed by repeater node id (not persisted). */
const ephemeralPasswords = new Map<number, string>();

export function setMeshcoreRepeaterEphemeralPassword(nodeId: number, password: string): void {
  const trimmed = password.trim();
  if (!trimmed) {
    ephemeralPasswords.delete(nodeId >>> 0);
    return;
  }
  ephemeralPasswords.set(nodeId >>> 0, trimmed);
}

export function clearMeshcoreRepeaterEphemeralPassword(nodeId: number): void {
  ephemeralPasswords.delete(nodeId >>> 0);
}

/** True when a persisted or session-only password can satisfy repeater admin login. */
export function meshcoreRepeaterHasResolvablePassword(nodeId: number): boolean {
  if (getMeshcoreRepeaterCredential(nodeId) != null) return true;
  const ephemeral = ephemeralPasswords.get(nodeId >>> 0);
  return !!ephemeral?.trim();
}

export function meshcoreRepeaterLoginErrorIsAuthFailure(error: unknown): boolean {
  return meshcoreLoginErrorIsAuthFailure(error);
}

/** Throw when a saved/ephemeral password login was attempted but failed (do not continue RPC). */
export function assertMeshcoreRepeaterLoginOk(result: MeshcoreRepeaterTryLoginResult): void {
  if (!result.attempted || result.ok) return;
  if (meshcoreRepeaterLoginErrorIsAuthFailure(result.error)) {
    throw new Error('authentication failed');
  }
  const msg = errLikeToLogString(result.error).toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) {
    throw new Error('timeout');
  }
  if (result.error instanceof Error) {
    throw result.error;
  }
  throw new Error(errLikeToLogString(result.error));
}

function resolveRepeaterPassword(nodeId: number): { password: string; fromPersisted: boolean } {
  const persisted = getMeshcoreRepeaterCredential(nodeId);
  if (persisted?.password.trim()) {
    return { password: persisted.password.trim(), fromPersisted: true };
  }
  const ephemeral = ephemeralPasswords.get(nodeId >>> 0);
  if (ephemeral?.trim()) {
    return { password: ephemeral.trim(), fromPersisted: false };
  }
  return { password: '', fromPersisted: false };
}

export interface MeshcoreRepeaterTryLoginResult {
  attempted: boolean;
  ok: boolean;
  fromPersisted: boolean;
  error?: unknown;
}

/**
 * Best-effort repeater admin login when a saved or ephemeral password exists.
 * Login is only sent on explicit user-triggered admin RPCs — never bulk/auto-fetch.
 * Failures are logged; returns result for UI feedback on persisted credential failures.
 */
export async function meshcoreRepeaterTryLogin(
  conn: MeshcoreRepeaterLoginConn,
  pubKey: Uint8Array,
  nodeId: number,
  runSerialized?: MeshcoreRepeaterRunSerialized,
  extraTimeoutMs: number = MESHCORE_TELEMETRY_TIMEOUT_MS,
): Promise<MeshcoreRepeaterTryLoginResult> {
  const { password, fromPersisted } = resolveRepeaterPassword(nodeId);
  if (!password) {
    return { attempted: false, ok: true, fromPersisted: false };
  }
  return meshcoreRepeaterTryLoginWithPassword(conn, pubKey, password, {
    fromPersisted,
    runSerialized,
    extraTimeoutMs,
  });
}

/**
 * SendLogin with an explicit admin password (ACL populate for remote CLI).
 * Used for Room servers where the password lives in room credentials, not repeater storage.
 */
export async function meshcoreRepeaterTryLoginWithPassword(
  conn: MeshcoreRepeaterLoginConn,
  pubKey: Uint8Array,
  password: string,
  opts?: {
    fromPersisted?: boolean;
    runSerialized?: MeshcoreRepeaterRunSerialized;
    extraTimeoutMs?: number;
  },
): Promise<MeshcoreRepeaterTryLoginResult> {
  const trimmed = password.trim();
  const fromPersisted = opts?.fromPersisted ?? false;
  if (!trimmed) {
    return { attempted: false, ok: true, fromPersisted: false };
  }
  const extraTimeoutMs = opts?.extraTimeoutMs ?? MESHCORE_TELEMETRY_TIMEOUT_MS;
  const runSerialized = opts?.runSerialized;
  const attempt = async (): Promise<void> => {
    await runMeshcoreRepeaterLogin(
      conn,
      pubKey,
      trimmed,
      extraTimeoutMs,
      runSerialized,
      runSerialized ? awaitMeshcoreRepeaterAdminRfIdle : undefined,
    );
  };
  try {
    await attempt();
    return { attempted: true, ok: true, fromPersisted };
  } catch (e) {
    const msg = errLikeToLogString(e).toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) {
      try {
        await attempt();
        return { attempted: true, ok: true, fromPersisted };
      } catch (retryErr) {
        console.warn(
          '[meshcoreRepeaterSession] repeater login retry failed ' + errLikeToLogString(retryErr),
        );
        return { attempted: true, ok: false, fromPersisted, error: retryErr };
      }
    }
    console.warn(
      '[meshcoreRepeaterSession] repeater login failed (continuing) ' + errLikeToLogString(e),
    );
    return { attempted: true, ok: false, fromPersisted, error: e };
  }
}

/** Clears all ephemeral session passwords (tests / logout). */
export function clearAllMeshcoreRepeaterEphemeralPasswords(): void {
  ephemeralPasswords.clear();
}
