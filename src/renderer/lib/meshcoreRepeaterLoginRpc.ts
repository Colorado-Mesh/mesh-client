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

/** Default extra timeout added to radio estTimeout for repeater admin login. */
export const MESHCORE_REPEATER_LOGIN_EXTRA_TIMEOUT_MS = 10_000;

/**
 * Resilient repeater admin login: keeps listening for LoginSuccess until prefix matches or timeout.
 * Replaces meshcore.js `login()` which uses `once(LoginSuccess)` and drops mismatched pushes.
 */
export function runMeshcoreRepeaterLogin(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  password: string,
  extraTimeoutMs: number = MESHCORE_REPEATER_LOGIN_EXTRA_TIMEOUT_MS,
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
      fail(new Error('repeater login rejected (wrong password or ACL denied)'));
    };

    const onSent = (response: unknown): void => {
      conn.off(MC_RESP_SENT, onSent);
      conn.off(MC_RESP_ERR, onErr);
      const r = response as { estTimeout?: number };
      const estTimeout = (r.estTimeout ?? 0) + extraTimeoutMs;
      responseTimeoutId = setTimeout(() => {
        fail('timeout');
      }, estTimeout);
    };

    const onErr = (): void => {
      fail(new Error('radio rejected repeater login'));
    };

    conn.on(MC_PUSH_LOGIN_SUCCESS, onLoginSuccess);
    conn.on(MC_PUSH_LOGIN_FAIL, onLoginFail);
    conn.on(MC_RESP_SENT, onSent);
    conn.on(MC_RESP_ERR, onErr);

    void conn
      .sendToRadioFrame(buildSendLoginFrame(contactPublicKey, password))
      .catch((err: unknown) => {
        fail(err);
      });
  });
}
