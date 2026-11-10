import { runMeshcoreRepeaterPrefixPushRequest } from './meshcoreRepeaterPrefixPushRpc';
import {
  buildSendStatusReqFrame,
  MC_PUSH_STATUS_RESPONSE,
  type MeshcoreRadioConnection,
  type MeshcoreRepeaterStats,
  type MeshcoreRepeaterStatusPush,
  parseRepeaterStatsFromStatusData,
} from './meshcoreRepeaterRpcCommon';
import { type MeshcoreRepeaterRunSerialized } from './meshcoreRepeaterRpcQueuedSend';

export interface MeshcoreRepeaterStatusRequestOpts {
  hopsAway?: number | null;
  /** Legacy fixed grace when hopsAway is omitted (tests). */
  extraTimeoutMs?: number;
  runSerialized?: MeshcoreRepeaterRunSerialized;
  beforeSend?: () => Promise<void>;
}

/**
 * Resilient repeater status request: keeps listening for StatusResponse until prefix matches or timeout.
 * Replaces meshcore.js `getStatus()` which uses `once(StatusResponse)` and drops mismatched pushes.
 */
export function runMeshcoreRepeaterStatusRequest(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  extraTimeoutMsOrOpts: number | MeshcoreRepeaterStatusRequestOpts,
  runSerialized?: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<MeshcoreRepeaterStats> {
  const opts: MeshcoreRepeaterStatusRequestOpts =
    typeof extraTimeoutMsOrOpts === 'number'
      ? { extraTimeoutMs: extraTimeoutMsOrOpts, runSerialized, beforeSend }
      : {
          ...extraTimeoutMsOrOpts,
          runSerialized: extraTimeoutMsOrOpts.runSerialized ?? runSerialized,
          beforeSend: extraTimeoutMsOrOpts.beforeSend ?? beforeSend,
        };
  return runMeshcoreRepeaterPrefixPushRequest({
    conn,
    contactPublicKey,
    hopsAway: opts.hopsAway,
    extraTimeoutMs: opts.extraTimeoutMs,
    runSerialized: opts.runSerialized,
    beforeSend: opts.beforeSend,
    pushEvent: MC_PUSH_STATUS_RESPONSE,
    logTag: 'meshcoreRepeaterStatusRpc',
    buildFrame: () => buildSendStatusReqFrame(contactPublicKey),
    rejectSentMessage: 'radio rejected status request',
    rejectFailureMessage: 'repeater status request failed',
    parseMatchedPush: (response) => {
      const r = response as MeshcoreRepeaterStatusPush;
      const statusData = r.statusData;
      if (!(statusData instanceof Uint8Array) || statusData.length < 48) {
        throw new Error('invalid status response payload');
      }
      return parseRepeaterStatsFromStatusData(statusData);
    },
  });
}
