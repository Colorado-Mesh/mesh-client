import {
  computeRoomLoginExtraTimeoutMs,
  computeRoomLoginSentWaitMs,
  type MeshcoreCompanionTransport,
} from './timeConstants';

/** DOMException.message when user cancels an in-flight room login. */
export const MESHCORE_ROOM_LOGIN_ABORT_MESSAGE = 'Room login cancelled';

/** meshcore.js CommandCodes.SendLogin */
const MC_CMD_SEND_LOGIN = 26;

/** meshcore.js ResponseCodes */
const MC_RESP_ERR = 1;
const MC_RESP_SENT = 6;

/** meshcore.js PushCodes.LoginSuccess */
const MC_PUSH_LOGIN_SUCCESS = 0x85;

/** meshcore.js PushCodes.LoginFail — wrong password / ACL denied (emitted after patch). */
const MC_PUSH_LOGIN_FAIL = 0x86;

export interface MeshcoreRoomLoginResponse {
  reserved?: number;
  pubKeyPrefix?: Uint8Array;
  permissions?: number;
}

/** Minimal connection surface for room SendLogin RPC. */
export interface MeshcoreRoomLoginRpcConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  once(event: string | number, cb: (...args: unknown[]) => void): void;
  sendToRadioFrame(data: Uint8Array): Promise<void>;
}

function writeCString(password: string, maxLength: number): Uint8Array {
  const bytes = new Uint8Array(new ArrayBuffer(maxLength));
  const encodedString = new TextEncoder().encode(password);
  for (let i = 0; i < maxLength && i < encodedString.length; i++) {
    bytes[i] = encodedString[i]!;
  }
  bytes[bytes.length - 1] = 0;
  return bytes;
}

/** Build SendLogin radio frame (matches patched meshcore.js sendCommandSendLogin). */
export function buildSendLoginFrame(publicKey: Uint8Array, password: string): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error('Room login requires a 32-byte public key');
  }
  const passwordField =
    password.length === 0 ? writeCString(password, 16) : new TextEncoder().encode(password);
  const frame = new Uint8Array(1 + 32 + passwordField.length);
  frame[0] = MC_CMD_SEND_LOGIN;
  frame.set(publicKey, 1);
  frame.set(passwordField, 33);
  return frame;
}

function pubKeyPrefixesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== 6 || b.length !== 6) return false;
  let diff = 0;
  for (let i = 0; i < 6; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function prefixToHex(prefix: Uint8Array): string {
  return Array.from(prefix)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function unknownToError(e: unknown, fallback: string): Error {
  if (e instanceof Error) return e;
  if (e === null || e === undefined) return new Error(fallback);
  if (typeof e === 'string') return new Error(e);
  return new Error(fallback);
}

/**
 * Resilient room server login: keeps listening for LoginSuccess until prefix matches or timeout.
 * Replaces meshcore.js `login()` which uses `once(LoginSuccess)` and drops mismatched pushes.
 */
export function runMeshcoreRoomLogin(
  conn: MeshcoreRoomLoginRpcConnection,
  contactPublicKey: Uint8Array,
  password: string,
  opts?: {
    hopsAway?: number;
    signal?: AbortSignal;
    companionTransport?: MeshcoreCompanionTransport;
  },
): Promise<MeshcoreRoomLoginResponse> {
  const expectedPrefix = contactPublicKey.subarray(0, 6);
  const extraTimeoutMs = computeRoomLoginExtraTimeoutMs(opts?.hopsAway ?? 0);
  const sentWaitMs = computeRoomLoginSentWaitMs(opts?.companionTransport);
  const signal = opts?.signal;

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let sentWaitTimer: ReturnType<typeof setTimeout> | undefined;
    let estTimeoutMs = 0;
    let sentReceived = false;

    const cleanup = (): void => {
      if (responseTimeoutId !== undefined) {
        clearTimeout(responseTimeoutId);
        responseTimeoutId = undefined;
      }
      if (sentWaitTimer !== undefined) {
        clearTimeout(sentWaitTimer);
        sentWaitTimer = undefined;
      }
      conn.off(MC_RESP_SENT, onSent);
      conn.off(MC_RESP_ERR, onErr);
      conn.off(MC_PUSH_LOGIN_SUCCESS, onLoginSuccess);
      conn.off(MC_PUSH_LOGIN_FAIL, onLoginFail);
      signal?.removeEventListener('abort', onAbort);
    };

    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (e === 'timeout') {
        reject(new Error('timeout'));
        return;
      }
      if (e instanceof DOMException) {
        reject(e);
        return;
      }
      reject(unknownToError(e, 'room login failed'));
    };

    const succeed = (response: MeshcoreRoomLoginResponse): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };

    const startResponseTimer = (): void => {
      if (settled || responseTimeoutId !== undefined) return;
      responseTimeoutId = setTimeout(() => {
        fail('timeout');
      }, estTimeoutMs + extraTimeoutMs);
    };

    const onAbort = (): void => {
      fail(new DOMException(MESHCORE_ROOM_LOGIN_ABORT_MESSAGE, 'AbortError'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const onLoginSuccess = (response: unknown): void => {
      const r = response as MeshcoreRoomLoginResponse;
      const prefix = r.pubKeyPrefix;
      if (!(prefix instanceof Uint8Array) || prefix.length !== 6) return;
      if (!pubKeyPrefixesEqual(expectedPrefix, prefix)) {
        console.debug(
          `[meshcoreRoomLoginRpc] LoginSuccess prefix mismatch expected=${prefixToHex(expectedPrefix)} got=${prefixToHex(prefix)}`,
        );
        return;
      }
      console.debug(
        `[meshcoreRoomLoginRpc] LoginSuccess prefix=${prefixToHex(prefix)} permissions=${String(r.permissions ?? 'n/a')}`,
      );
      succeed(r);
    };

    const onLoginFail = (response: unknown): void => {
      const r = response as MeshcoreRoomLoginResponse;
      const prefix = r.pubKeyPrefix;
      if (!(prefix instanceof Uint8Array) || prefix.length !== 6) return;
      if (!pubKeyPrefixesEqual(expectedPrefix, prefix)) {
        console.debug(
          `[meshcoreRoomLoginRpc] LoginFail prefix mismatch expected=${prefixToHex(expectedPrefix)} got=${prefixToHex(prefix)}`,
        );
        return;
      }
      console.debug(`[meshcoreRoomLoginRpc] LoginFail prefix=${prefixToHex(prefix)}`);
      fail(new Error('room login rejected (wrong password or ACL denied)'));
    };

    const onSent = (response: unknown): void => {
      if (sentReceived) return;
      sentReceived = true;
      if (sentWaitTimer !== undefined) {
        clearTimeout(sentWaitTimer);
        sentWaitTimer = undefined;
      }
      conn.off(MC_RESP_SENT, onSent);
      conn.off(MC_RESP_ERR, onErr);
      const r = response as { estTimeout?: number };
      estTimeoutMs = r.estTimeout ?? 0;
      console.debug(
        `[meshcoreRoomLoginRpc] SendLogin SENT estTimeoutMs=${estTimeoutMs} extraTimeoutMs=${extraTimeoutMs} hops=${String(opts?.hopsAway ?? 0)}`,
      );
      startResponseTimer();
    };

    const onErr = (): void => {
      if (sentWaitTimer !== undefined) {
        clearTimeout(sentWaitTimer);
        sentWaitTimer = undefined;
      }
      fail(new Error('radio rejected room login'));
    };

    conn.on(MC_PUSH_LOGIN_SUCCESS, onLoginSuccess);
    conn.on(MC_PUSH_LOGIN_FAIL, onLoginFail);
    conn.once(MC_RESP_SENT, onSent);
    conn.once(MC_RESP_ERR, onErr);

    sentWaitTimer = setTimeout(() => {
      if (settled || sentReceived) return;
      fail(new Error('timeout waiting for room login acknowledgment'));
    }, sentWaitMs);

    void conn
      .sendToRadioFrame(buildSendLoginFrame(contactPublicKey, password))
      .catch((err: unknown) => {
        fail(err);
      });
  });
}
