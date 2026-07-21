import { runMeshcoreRepeaterPrefixPushRequest } from './meshcoreRepeaterPrefixPushRpc';
import {
  buildSendLoginFrame,
  MC_PUSH_LOGIN_FAIL,
  MC_PUSH_LOGIN_SUCCESS,
  type MeshcoreRadioConnection,
  type MeshcoreRepeaterLoginResponse,
  normalizePubKeyPrefix,
  prefixToHex,
  pubKeyPrefixesEqual,
  requireContactPubKeyPrefix,
} from './meshcoreRepeaterRpcCommon';
import type { MeshcoreRepeaterRunSerialized } from './meshcoreRepeaterRpcQueuedSend';

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
  const expectedPrefix = requireContactPubKeyPrefix(contactPublicKey);

  return runMeshcoreRepeaterPrefixPushRequest<MeshcoreRepeaterLoginResponse>({
    conn,
    contactPublicKey,
    extraTimeoutMs,
    runSerialized,
    beforeSend,
    pushEvent: MC_PUSH_LOGIN_SUCCESS,
    logTag: 'meshcoreRepeaterLoginRpc',
    buildFrame: () => buildSendLoginFrame(contactPublicKey, password),
    parseMatchedPush: (response) => response as MeshcoreRepeaterLoginResponse,
    rejectSentMessage: 'radio rejected repeater login',
    rejectFailureMessage: 'repeater login failed',
    auxiliaryPushEvents: [
      {
        event: MC_PUSH_LOGIN_FAIL,
        onMatchedPrefix: (response) => {
          const r = response as MeshcoreRepeaterLoginResponse;
          const prefix = normalizePubKeyPrefix(r.pubKeyPrefix);
          if (!prefix || !pubKeyPrefixesEqual(expectedPrefix, prefix)) return;
          console.debug(
            `[meshcoreRepeaterLoginRpc] LoginFail prefix=${prefixToHex(prefix)} (waiting for possible LoginSuccess)`,
          );
        },
      },
    ],
  });
}
