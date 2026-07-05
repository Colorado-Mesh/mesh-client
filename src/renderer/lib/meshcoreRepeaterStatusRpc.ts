import {
  buildSendStatusReqFrame,
  MC_PUSH_STATUS_RESPONSE,
  MC_RESP_ERR,
  MC_RESP_SENT,
  type MeshcoreRadioConnection,
  type MeshcoreRepeaterStats,
  type MeshcoreRepeaterStatusPush,
  normalizePubKeyPrefix,
  parseRepeaterStatsFromStatusData,
  prefixToHex,
  pubKeyPrefixesEqual,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import {
  type MeshcoreRepeaterRunSerialized,
  runMeshcoreRepeaterQueuedSend,
} from './meshcoreRepeaterRpcQueuedSend';

/**
 * Resilient repeater status request: keeps listening for StatusResponse until prefix matches or timeout.
 * Replaces meshcore.js `getStatus()` which uses `once(StatusResponse)` and drops mismatched pushes.
 */
export function runMeshcoreRepeaterStatusRequest(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  extraTimeoutMs: number,
  runSerialized?: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<MeshcoreRepeaterStats> {
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
      conn.off(MC_PUSH_STATUS_RESPONSE, onStatusResponsePush);
    };

    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (e === 'timeout') {
        reject(new Error('timeout'));
        return;
      }
      reject(unknownToError(e, 'repeater status request failed'));
    };

    const succeed = (stats: MeshcoreRepeaterStats): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(stats);
    };

    const onStatusResponsePush = (response: unknown): void => {
      const r = response as MeshcoreRepeaterStatusPush;
      const prefix = normalizePubKeyPrefix(r.pubKeyPrefix);
      if (!prefix) return;
      if (!pubKeyPrefixesEqual(expectedPrefix, prefix)) {
        console.debug(
          `[meshcoreRepeaterStatusRpc] StatusResponse prefix mismatch expected=${prefixToHex(expectedPrefix)} got=${prefixToHex(prefix)}`,
        );
        return;
      }
      const statusData = r.statusData;
      if (!(statusData instanceof Uint8Array) || statusData.length < 48) {
        fail(new Error('invalid status response payload'));
        return;
      }
      succeed(parseRepeaterStatsFromStatusData(statusData));
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
      fail(new Error('radio rejected status request'));
    };

    conn.on(MC_PUSH_STATUS_RESPONSE, onStatusResponsePush);

    if (runSerialized) {
      void runMeshcoreRepeaterQueuedSend(
        conn,
        runSerialized,
        () => conn.sendToRadioFrame(buildSendStatusReqFrame(contactPublicKey)),
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

    void conn.sendToRadioFrame(buildSendStatusReqFrame(contactPublicKey)).catch((err: unknown) => {
      fail(err);
    });
  });
}
