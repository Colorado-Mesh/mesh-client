import {
  buildSendLoginFrame,
  MC_PUSH_LOGIN_FAIL,
  MC_PUSH_LOGIN_SUCCESS,
  MC_RESP_ERR,
  MC_RESP_SENT,
  type MeshcoreRadioConnection,
  type MeshcoreRepeaterLoginResponse,
  normalizePubKeyPrefix,
  prefixToHex,
  pubKeyPrefixesEqual,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import {
  type MeshcoreRepeaterRunSerialized,
  runMeshcoreRepeaterQueuedSend,
} from './meshcoreRepeaterRpcQueuedSend';

/** Default extra timeout added to radio estTimeout for repeater admin login. */
export const MESHCORE_REPEATER_LOGIN_EXTRA_TIMEOUT_MS = 10_000;

/**
 * Resilient repeater admin login: keeps listening for LoginSuccess until prefix matches or timeout.
 * Matches meshcore.js `login()` — LoginFail is not an immediate reject (companion may emit it
 * before a later LoginSuccess on congested links). Timeout after LoginFail is reported as timeout,
 * not wrong password (LoginFail alone is not proof of bad credentials on busy links).
 */
export function runMeshcoreRepeaterLogin(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  password: string,
  extraTimeoutMs: number = MESHCORE_REPEATER_LOGIN_EXTRA_TIMEOUT_MS,
  runSerialized?: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<MeshcoreRepeaterLoginResponse> {
  const expectedPrefix = contactPublicKey.subarray(0, 6);

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (responseTimeoutId !== undefined) {
        clearTimeout(responseTimeoutId);
        responseTimeoutId = undefined;
      }
      conn.off(MC_RESP_SENT, onSent);
      conn.off(MC_RESP_ERR, onErr);
      conn.off(MC_PUSH_LOGIN_SUCCESS, onLoginSuccess);
      conn.off(MC_PUSH_LOGIN_FAIL, onLoginFail);
    };

    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (e === 'timeout') {
        reject(new Error('timeout'));
        return;
      }
      reject(unknownToError(e, 'repeater login failed'));
    };

    const succeed = (response: MeshcoreRepeaterLoginResponse): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };

    const onLoginSuccess = (response: unknown): void => {
      const r = response as MeshcoreRepeaterLoginResponse;
      const prefix = normalizePubKeyPrefix(r.pubKeyPrefix);
      if (!prefix) return;
      if (!pubKeyPrefixesEqual(expectedPrefix, prefix)) {
        console.debug(
          `[meshcoreRepeaterLoginRpc] LoginSuccess prefix mismatch expected=${prefixToHex(expectedPrefix)} got=${prefixToHex(prefix)}`,
        );
        return;
      }
      succeed(r);
    };

    const onLoginFail = (response: unknown): void => {
      const r = response as MeshcoreRepeaterLoginResponse;
      const prefix = normalizePubKeyPrefix(r.pubKeyPrefix);
      if (!prefix) return;
      if (!pubKeyPrefixesEqual(expectedPrefix, prefix)) {
        console.debug(
          `[meshcoreRepeaterLoginRpc] LoginFail prefix mismatch expected=${prefixToHex(expectedPrefix)} got=${prefixToHex(prefix)}`,
        );
        return;
      }
      console.debug(
        `[meshcoreRepeaterLoginRpc] LoginFail prefix=${prefixToHex(prefix)} (waiting for possible LoginSuccess)`,
      );
    };

    const armResponseTimeout = (estTimeoutMs: number): void => {
      responseTimeoutId = setTimeout(() => {
        fail('timeout');
      }, estTimeoutMs + extraTimeoutMs);
    };

    const onSent = (response: unknown): void => {
      conn.off(MC_RESP_SENT, onSent);
      conn.off(MC_RESP_ERR, onErr);
      const r = response as { estTimeout?: number };
      armResponseTimeout(r.estTimeout ?? 0);
    };

    const onErr = (): void => {
      fail(new Error('radio rejected repeater login'));
    };

    conn.on(MC_PUSH_LOGIN_SUCCESS, onLoginSuccess);
    conn.on(MC_PUSH_LOGIN_FAIL, onLoginFail);

    const sendLogin = (): Promise<void> =>
      conn.sendToRadioFrame(buildSendLoginFrame(contactPublicKey, password));

    if (runSerialized) {
      void runMeshcoreRepeaterQueuedSend(conn, runSerialized, sendLogin, beforeSend)
        .then(({ estTimeoutMs }) => {
          armResponseTimeout(estTimeoutMs);
        })
        .catch(fail);
      return;
    }

    conn.on(MC_RESP_SENT, onSent);
    conn.on(MC_RESP_ERR, onErr);
    void sendLogin().catch((err: unknown) => {
      fail(err);
    });
  });
}
