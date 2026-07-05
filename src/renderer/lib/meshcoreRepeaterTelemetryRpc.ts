import { runMeshcoreRepeaterPrefixPushRequest } from './meshcoreRepeaterPrefixPushRpc';
import {
  buildSendTelemetryReqFrame,
  MC_PUSH_TELEMETRY_RESPONSE,
  type MeshcoreRadioConnection,
  type MeshcoreRepeaterTelemetryPush,
} from './meshcoreRepeaterRpcCommon';
import { type MeshcoreRepeaterRunSerialized } from './meshcoreRepeaterRpcQueuedSend';

/**
 * Resilient telemetry request: keeps listening for TelemetryResponse until prefix matches or timeout.
 * Replaces meshcore.js `getTelemetry()` which uses `once(TelemetryResponse)` and drops mismatched pushes.
 */
export function runMeshcoreRepeaterTelemetryRequest(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  extraTimeoutMs: number,
  runSerialized?: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<MeshcoreRepeaterTelemetryPush> {
  return runMeshcoreRepeaterPrefixPushRequest({
    conn,
    contactPublicKey,
    extraTimeoutMs,
    runSerialized,
    beforeSend,
    pushEvent: MC_PUSH_TELEMETRY_RESPONSE,
    logTag: 'meshcoreRepeaterTelemetryRpc',
    buildFrame: () => buildSendTelemetryReqFrame(contactPublicKey),
    rejectSentMessage: 'radio rejected telemetry request',
    rejectFailureMessage: 'telemetry request failed',
    parseMatchedPush: (response) => response as MeshcoreRepeaterTelemetryPush,
  });
}
