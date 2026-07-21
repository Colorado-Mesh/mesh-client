import {
  buildSendLoginFrame,
  type MeshcoreRadioConnection,
  normalizePubKeyPrefix,
  prefixToHex,
  pubKeyPrefixesEqual,
  requireContactPubKeyPrefix,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import {
  MC_PUSH_LOGIN_FAIL,
  MC_PUSH_LOGIN_SUCCESS,
  MC_RESP_ERR,
  MC_RESP_SENT,
} from './meshcoreWireCodes';
import {
  computeRoomLoginExtraTimeoutMs,
  computeRoomLoginResponseWaitMs,
  computeRoomLoginSentWaitMs,
  type MeshcoreCompanionTransport,
} from './timeConstants';

/** DOMException.message when user cancels an in-flight room login. */
export const MESHCORE_ROOM_LOGIN_ABORT_MESSAGE = 'Room login cancelled';

export interface MeshcoreRoomLoginResponse {
  reserved?: number;
  pubKeyPrefix?: Uint8Array;
  permissions?: number;
}

/** Accept Uint8Array and other array-likes from meshcore.js push payloads. */
export const normalizeLoginPubKeyPrefix = normalizePubKeyPrefix;

export { buildSendLoginFrame } from './meshcoreRepeaterRpcCommon';

export function runMeshcoreRoomLogin(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  password: string,
  opts?: {
    hopsAway?: number;
    signal?: AbortSignal;
    companionTransport?: MeshcoreCompanionTransport;
  },
): Promise<MeshcoreRoomLoginResponse> {
  const expectedPrefix = requireContactPubKeyPrefix(contactPublicKey);
  const extraTimeoutMs = computeRoomLoginExtraTimeoutMs(opts?.hopsAway);
  const sentWaitMs = computeRoomLoginSentWaitMs(opts?.companionTransport);
  const signal = opts?.signal;

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let sentWaitTimer: ReturnType<typeof setTimeout> | undefined;
    let estTimeoutMs = 0;
    let sentReceived = false;
    let acceptSentErr = false;

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
      const responseWaitMs = computeRoomLoginResponseWaitMs(opts?.hopsAway, estTimeoutMs);
      responseTimeoutId = setTimeout(() => {
        fail('timeout');
      }, responseWaitMs);
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
      const prefix = normalizeLoginPubKeyPrefix(r.pubKeyPrefix);
      if (!prefix) {
        return;
      }
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
      const prefix = normalizeLoginPubKeyPrefix(r.pubKeyPrefix);
      if (!prefix) return;
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
      if (!acceptSentErr) return;
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
      if (!acceptSentErr) return;
      if (sentWaitTimer !== undefined) {
        clearTimeout(sentWaitTimer);
        sentWaitTimer = undefined;
      }
      fail(new Error('radio rejected room login'));
    };

    conn.on(MC_PUSH_LOGIN_SUCCESS, onLoginSuccess);
    conn.on(MC_PUSH_LOGIN_FAIL, onLoginFail);
    conn.on(MC_RESP_SENT, onSent);
    conn.on(MC_RESP_ERR, onErr);

    sentWaitTimer = setTimeout(() => {
      if (settled || sentReceived) return;
      fail(new Error('timeout waiting for room login acknowledgment'));
    }, sentWaitMs);

    void conn
      .sendToRadioFrame(buildSendLoginFrame(contactPublicKey, password))
      .then(() => {
        acceptSentErr = true;
      })
      .catch((err: unknown) => {
        fail(err);
      });
  });
}
