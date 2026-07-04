import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { runMeshcoreRepeaterLogin } from './meshcoreRepeaterLoginRpc';
import type { MeshcoreRadioConnection } from './meshcoreRepeaterRpcCommon';
import { meshcoreGetRepeaterSessionPassword } from './meshcoreUtils';

/** Minimal connection surface for repeater admin login RPC. */
export type MeshcoreRepeaterLoginConn = MeshcoreRadioConnection;

/**
 * Best-effort repeater admin login when a session password is set.
 * Failures are logged only by the caller if needed; does not throw.
 */
export async function meshcoreRepeaterTryLogin(
  conn: MeshcoreRepeaterLoginConn,
  pubKey: Uint8Array,
): Promise<void> {
  const password = meshcoreGetRepeaterSessionPassword().trim();
  if (!password) return;
  try {
    await runMeshcoreRepeaterLogin(conn, pubKey, password);
  } catch (e) {
    console.warn(
      '[meshcoreRepeaterSession] repeater login failed (continuing) ' + errLikeToLogString(e),
    );
  }
}
