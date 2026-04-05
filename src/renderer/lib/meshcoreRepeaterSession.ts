import { meshcoreGetRepeaterSessionPassword } from './meshcoreUtils';

/** Minimal connection surface for repeater admin `login`. */
export interface MeshcoreRepeaterLoginConn {
  login(
    contactPublicKey: Uint8Array,
    password: string,
    extraTimeoutMillis?: number,
  ): Promise<unknown>;
}

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
    await conn.login(pubKey, password, 2000);
  } catch (e) {
    console.warn('[meshcoreRepeaterSession] repeater login failed (continuing)', e);
  }
}
