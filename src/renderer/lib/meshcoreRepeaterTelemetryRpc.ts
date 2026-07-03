import {
  buildSendTelemetryReqFrame,
  MC_PUSH_TELEMETRY_RESPONSE,
  MC_RESP_ERR,
  MC_RESP_SENT,
  type MeshcoreRepeaterRpcConnection,
  type MeshcoreRepeaterTelemetryPush,
  normalizePubKeyPrefix,
  prefixToHex,
  pubKeyPrefixesEqual,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';

/**
 * Resilient telemetry request: keeps listening for TelemetryResponse until prefix matches or timeout.
 * Replaces meshcore.js `getTelemetry()` which uses `once(TelemetryResponse)` and drops mismatched pushes.
 */
export function runMeshcoreRepeaterTelemetryRequest(
  conn: MeshcoreRepeaterRpcConnection,
  contactPublicKey: Uint8Array,
  extraTimeoutMs: number,
): Promise<MeshcoreRepeaterTelemetryPush> {
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
      conn.off(MC_PUSH_TELEMETRY_RESPONSE, onTelemetryResponsePush);
    };

    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (e === 'timeout') {
        reject(new Error('timeout'));
        return;
      }
      reject(unknownToError(e, 'telemetry request failed'));
    };

    const succeed = (response: MeshcoreRepeaterTelemetryPush): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };

    const onTelemetryResponsePush = (response: unknown): void => {
      const r = response as MeshcoreRepeaterTelemetryPush;
      const prefix = normalizePubKeyPrefix(r.pubKeyPrefix);
      if (!prefix) return;
      if (!pubKeyPrefixesEqual(expectedPrefix, prefix)) {
        console.debug(
          `[meshcoreRepeaterTelemetryRpc] TelemetryResponse prefix mismatch expected=${prefixToHex(expectedPrefix)} got=${prefixToHex(prefix)}`,
        );
        return;
      }
      succeed(r);
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
      fail(new Error('radio rejected telemetry request'));
    };

    conn.on(MC_PUSH_TELEMETRY_RESPONSE, onTelemetryResponsePush);
    conn.on(MC_RESP_SENT, onSent);
    conn.on(MC_RESP_ERR, onErr);

    void conn
      .sendToRadioFrame(buildSendTelemetryReqFrame(contactPublicKey))
      .catch((err: unknown) => {
        fail(err);
      });
  });
}
