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

/** Default extra timeout when hopsAway is omitted (legacy / tests). */
export const MESHCORE_REPEATER_LOGIN_EXTRA_TIMEOUT_MS = 10_000;

export interface MeshcoreRepeaterLoginRequestOpts {
  hopsAway?: number | null;
  extraTimeoutMs?: number;
  runSerialized?: MeshcoreRepeaterRunSerialized;
  beforeSend?: () => Promise<void>;
}

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
  extraTimeoutMsOrOpts:
    number | MeshcoreRepeaterLoginRequestOpts = MESHCORE_REPEATER_LOGIN_EXTRA_TIMEOUT_MS,
  runSerialized?: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<MeshcoreRepeaterLoginResponse> {
  const opts: MeshcoreRepeaterLoginRequestOpts =
    typeof extraTimeoutMsOrOpts === 'number'
      ? { extraTimeoutMs: extraTimeoutMsOrOpts, runSerialized, beforeSend }
      : {
          ...extraTimeoutMsOrOpts,
          runSerialized: extraTimeoutMsOrOpts.runSerialized ?? runSerialized,
          beforeSend: extraTimeoutMsOrOpts.beforeSend ?? beforeSend,
        };
  const expectedPrefix = requireContactPubKeyPrefix(contactPublicKey);

  return runMeshcoreRepeaterPrefixPushRequest<MeshcoreRepeaterLoginResponse>({
    conn,
    contactPublicKey,
    hopsAway: opts.hopsAway,
    extraTimeoutMs: opts.extraTimeoutMs,
    runSerialized: opts.runSerialized,
    beforeSend: opts.beforeSend,
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
