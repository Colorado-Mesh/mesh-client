import {
  buildSendTelemetryReqFrame,
  MC_PUSH_TELEMETRY_RESPONSE,
  MC_RESP_ERR,
  MC_RESP_SENT,
  type MeshcoreRadioConnection,
  type MeshcoreRepeaterTelemetryPush,
  normalizePubKeyPrefix,
  prefixToHex,
  pubKeyPrefixesEqual,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import {
  type MeshcoreRepeaterRunSerialized,
  runMeshcoreRepeaterQueuedSend,
} from './meshcoreRepeaterRpcQueuedSend';

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
      fail(new Error('radio rejected telemetry request'));
    };

    conn.on(MC_PUSH_TELEMETRY_RESPONSE, onTelemetryResponsePush);

    if (runSerialized) {
      void runMeshcoreRepeaterQueuedSend(
        conn,
        runSerialized,
        () => conn.sendToRadioFrame(buildSendTelemetryReqFrame(contactPublicKey)),
        beforeSend,
      )
        .then(({ estTimeoutMs }) => {
          armResponseTimeout(estTimeoutMs);
        })
        .catch(fail);
      return;
    }

    conn.on(MC_RESP_SENT, onSent);
    conn.on(MC_RESP_ERR, onErr);

    void conn
      .sendToRadioFrame(buildSendTelemetryReqFrame(contactPublicKey))
      .catch((err: unknown) => {
        fail(err);
      });
  });
}
