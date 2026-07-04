import type { MeshcoreRadioConnection } from './meshcoreRepeaterRpcCommon';
import { MC_CMD_LOGOUT, MC_RESP_ERR, MC_RESP_OK } from './meshcoreWireCodes';
import { computeRoomLoginSentWaitMs, type MeshcoreCompanionTransport } from './timeConstants';

/** Build SendLogout radio frame (cmd 29 + 32-byte room server pubkey). */
export function buildSendLogoutFrame(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error('Room logout requires a 32-byte public key');
  }
  const frame = new Uint8Array(1 + 32);
  frame[0] = MC_CMD_LOGOUT;
  frame.set(publicKey, 1);
  return frame;
}

function unknownToError(e: unknown, fallback: string): Error {
  if (e instanceof Error) return e;
  if (e === null || e === undefined) return new Error(fallback);
  if (typeof e === 'string') return new Error(e);
  return new Error(fallback);
}

/**
 * Send LOGOUT to companion radio and wait for Ok or Err.
 * Failure point: radio timeout or Err — rejects; caller shows UI error.
 */
export function runMeshcoreRoomLogout(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  opts?: {
    companionTransport?: MeshcoreCompanionTransport;
  },
): Promise<void> {
  const timeoutMs = computeRoomLoginSentWaitMs(opts?.companionTransport);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      conn.off(MC_RESP_OK, onOk);
      conn.off(MC_RESP_ERR, onErr);
    };

    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (e === 'timeout') {
        reject(new Error('timeout'));
        return;
      }
      reject(unknownToError(e, 'room logout failed'));
    };

    const succeed = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onOk = (): void => {
      console.debug('[meshcoreRoomLogoutRpc] SendLogout OK');
      succeed();
    };

    const onErr = (): void => {
      fail(new Error('radio rejected room logout'));
    };

    conn.once(MC_RESP_OK, onOk);
    conn.once(MC_RESP_ERR, onErr);

    timeoutId = setTimeout(() => {
      fail('timeout');
    }, timeoutMs);

    void conn.sendToRadioFrame(buildSendLogoutFrame(contactPublicKey)).catch((err: unknown) => {
      fail(err);
    });
  });
}
