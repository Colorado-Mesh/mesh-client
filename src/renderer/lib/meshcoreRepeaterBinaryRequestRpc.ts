import {
  buildSendBinaryReqFrame,
  MC_PUSH_BINARY_RESPONSE,
  type MeshcoreRadioConnection,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import {
  type MeshcoreRepeaterRunSerialized,
  runMeshcoreRepeaterQueuedSend,
} from './meshcoreRepeaterRpcQueuedSend';

/**
 * Resilient binary request: queue only covers send + SENT; BinaryResponse is matched by tag.
 * Replaces meshcore.js `sendBinaryRequest()` for repeater admin RPCs that share the companion queue.
 */
export function runMeshcoreRepeaterBinaryRequest(
  conn: MeshcoreRadioConnection,
  contactPublicKey: Uint8Array,
  requestCodeAndParams: Uint8Array,
  extraTimeoutMs: number,
  runSerialized: MeshcoreRepeaterRunSerialized,
  beforeSend?: () => Promise<void>,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let expectedTag: number | null = null;
    let responseTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (responseTimeoutId !== undefined) {
        clearTimeout(responseTimeoutId);
        responseTimeoutId = undefined;
      }
      conn.off(MC_PUSH_BINARY_RESPONSE, onBinaryResponsePush);
    };

    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (e === 'timeout') {
        reject(new Error('timeout'));
        return;
      }
      reject(unknownToError(e, 'binary request failed'));
    };

    const succeed = (responseData: Uint8Array): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(responseData);
    };

    const onBinaryResponsePush = (response: unknown): void => {
      const r = response as { tag?: number; responseData?: Uint8Array };
      const tag = r.tag;
      if (expectedTag === null) {
        return;
      }
      if ((tag ?? 0) >>> 0 !== expectedTag >>> 0) {
        return;
      }
      const responseData = r.responseData;
      if (!(responseData instanceof Uint8Array)) {
        fail(new Error('invalid binary response payload'));
        return;
      }
      succeed(responseData);
    };

    conn.on(MC_PUSH_BINARY_RESPONSE, onBinaryResponsePush);

    const armResponseWait = (estTimeoutMs: number, expectedAckCrc: number | undefined): void => {
      if (expectedAckCrc === undefined) {
        fail(new Error('binary request missing expectedAckCrc tag'));
        return;
      }
      expectedTag = expectedAckCrc >>> 0;
      responseTimeoutId = setTimeout(() => {
        fail('timeout');
      }, estTimeoutMs + extraTimeoutMs);
    };

    void runMeshcoreRepeaterQueuedSend(
      conn,
      runSerialized,
      () => conn.sendToRadioFrame(buildSendBinaryReqFrame(contactPublicKey, requestCodeAndParams)),
      beforeSend,
      ({ estTimeoutMs, expectedAckCrc }) => {
        armResponseWait(estTimeoutMs, expectedAckCrc);
      },
    ).catch(fail);
  });
}
