import { runMeshcoreCompanionRequest } from './meshcoreCompanionRequestQueue';
import {
  buildSendSelfTelemetryReqFrame,
  MC_PUSH_TELEMETRY_RESPONSE,
  type MeshcoreRadioConnection,
  type MeshcoreRepeaterTelemetryPush,
  normalizePubKeyPrefix,
  prefixToHex,
  pubKeyPrefixesEqual,
  requireContactPubKeyPrefix,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import { MESHCORE_POST_CONNECT_SELF_TELEMETRY_TIMEOUT_MS } from './timeConstants';

export interface MeshcoreSelfTelemetryRequestOpts {
  /** Wait for TelemetryResponse (default: post-connect TCP budget). */
  timeoutMs?: number;
}

/**
 * Request the connected companion's own Cayenne LPP telemetry (battery, sensors, GPS when active).
 * Unlike repeater telemetry, firmware responds with an immediate push — no RESP_SENT / RF hop.
 */
export function runMeshcoreSelfTelemetryRequest(
  conn: MeshcoreRadioConnection,
  selfPublicKey: Uint8Array,
  opts?: MeshcoreSelfTelemetryRequestOpts,
): Promise<MeshcoreRepeaterTelemetryPush> {
  const expectedPrefix = requireContactPubKeyPrefix(selfPublicKey);
  const timeoutMs = opts?.timeoutMs ?? MESHCORE_POST_CONNECT_SELF_TELEMETRY_TIMEOUT_MS;

  return runMeshcoreCompanionRequest(
    conn,
    () =>
      new Promise<MeshcoreRepeaterTelemetryPush>((resolve, reject) => {
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const cleanup = (): void => {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          conn.off(MC_PUSH_TELEMETRY_RESPONSE, onPush);
        };

        const fail = (e: unknown): void => {
          if (settled) return;
          settled = true;
          cleanup();
          if (e === 'timeout') {
            reject(new Error('timeout'));
            return;
          }
          reject(unknownToError(e, 'self telemetry request failed'));
        };

        const succeed = (value: MeshcoreRepeaterTelemetryPush): void => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };

        const onPush = (response: unknown): void => {
          const r = response as { pubKeyPrefix?: unknown };
          const prefix = normalizePubKeyPrefix(r.pubKeyPrefix);
          if (!prefix) return;
          if (!pubKeyPrefixesEqual(expectedPrefix, prefix)) {
            console.debug(
              `[meshcoreSelfTelemetryRpc] prefix mismatch expected=${prefixToHex(expectedPrefix)} got=${prefixToHex(prefix)}`,
            );
            return;
          }
          succeed(response as MeshcoreRepeaterTelemetryPush);
        };

        conn.on(MC_PUSH_TELEMETRY_RESPONSE, onPush);
        timeoutId = setTimeout(() => {
          fail('timeout');
        }, timeoutMs);

        void conn.sendToRadioFrame(buildSendSelfTelemetryReqFrame()).catch((err: unknown) => {
          fail(err);
        });
      }),
  );
}
