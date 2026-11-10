import { runMeshcoreRepeaterPrefixPushRequest } from './meshcoreRepeaterPrefixPushRpc';
import {
  buildSendTelemetryReqFrame,
  MC_PUSH_TELEMETRY_RESPONSE,
  type MeshcoreRadioConnection,
  type MeshcoreRepeaterTelemetryPush,
} from './meshcoreRepeaterRpcCommon';
import { type MeshcoreRepeaterRunSerialized } from './meshcoreRepeaterRpcQueuedSend';

export interface MeshcoreRepeaterTelemetryRequestOpts {
  hopsAway?: number | null;
  /** Legacy fixed grace when hopsAway is omitted (tests). */
  extraTimeoutMs?: number;
  runSerialized?: MeshcoreRepeaterRunSerialized;
  beforeSend?: () => Promise<void>;
}

/**
 * Resilient telemetry request: keeps listening for TelemetryResponse until prefix matches or timeout.
 * Replaces meshcore.js `getTelemetry()` which uses `once(TelemetryResponse)` and drops mismatched pushes.
 */
export function runMeshcoreRepeaterTelemetryRequest(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  extraTimeoutMsOrOpts: number | MeshcoreRepeaterTelemetryRequestOpts,
  runSerialized?: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<MeshcoreRepeaterTelemetryPush> {
  const opts: MeshcoreRepeaterTelemetryRequestOpts =
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
    pushEvent: MC_PUSH_TELEMETRY_RESPONSE,
    logTag: 'meshcoreRepeaterTelemetryRpc',
    buildFrame: () => buildSendTelemetryReqFrame(contactPublicKey),
    rejectSentMessage: 'radio rejected telemetry request',
    rejectFailureMessage: 'telemetry request failed',
    parseMatchedPush: (response) => response as MeshcoreRepeaterTelemetryPush,
  });
}
