import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { getMeshcoreRepeaterCredential } from './meshcoreRepeaterCredentialStorage';
import { runMeshcoreRepeaterLogin } from './meshcoreRepeaterLoginRpc';
import type { MeshcoreRadioConnection } from './meshcoreRepeaterRpcCommon';

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

export function meshcoreRepeaterLoginErrorIsAuthFailure(error: unknown): boolean {
  const msg = errLikeToLogString(error).toLowerCase();
  return msg.includes('rejected') || msg.includes('wrong password') || msg.includes('acl denied');
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
): Promise<MeshcoreRepeaterTryLoginResult> {
  const { password, fromPersisted } = resolveRepeaterPassword(nodeId);
  if (!password) {
    return { attempted: false, ok: true, fromPersisted: false };
  }
  try {
    await runMeshcoreRepeaterLogin(conn, pubKey, password);
    return { attempted: true, ok: true, fromPersisted };
  } catch (e) {
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
