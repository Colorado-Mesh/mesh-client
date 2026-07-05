import {
  MC_RESP_ERR,
  MC_RESP_SENT,
  type MeshcoreRadioConnection,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import { MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS } from './timeConstants';

export type MeshcoreRepeaterRunSerialized = <T>(fn: () => Promise<T>) => Promise<T>;

export interface MeshcoreRepeaterQueuedSendResult {
  estTimeoutMs: number;
  expectedAckCrc?: number;
}

/**
 * Hold the companion RPC queue only until `RESP_SENT` (or `RESP_ERR`).
 * Response waits must run outside this helper so ping/trace sends are not blocked.
 * Optional `beforeSend` runs inside the queue slot immediately before the frame is sent
 * (e.g. wait for an in-flight ping to finish).
 */
export async function runMeshcoreRepeaterQueuedSend(
  conn: MeshcoreRadioConnection,
  runSerialized: MeshcoreRepeaterRunSerialized,
  sendFrame: () => Promise<void>,
  beforeSend?: () => Promise<void>,
): Promise<MeshcoreRepeaterQueuedSendResult> {
  return runSerialized(async () => {
    if (beforeSend) {
      await beforeSend();
    }
    return new Promise<MeshcoreRepeaterQueuedSendResult>((resolve, reject) => {
      let sentWaitTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (sentWaitTimer !== undefined) {
          clearTimeout(sentWaitTimer);
          sentWaitTimer = undefined;
        }
        conn.off(MC_RESP_SENT, onSent);
        conn.off(MC_RESP_ERR, onErr);
      };
      const onSent = (response: unknown): void => {
        cleanup();
        const r = response as { estTimeout?: number; expectedAckCrc?: number };
        resolve({
          estTimeoutMs: r.estTimeout ?? 0,
          expectedAckCrc: r.expectedAckCrc,
        });
      };
      const onErr = (): void => {
        cleanup();
        reject(new Error('radio rejected request'));
      };
      sentWaitTimer = setTimeout(() => {
        cleanup();
        reject(new Error('timeout waiting for sent acknowledgment'));
      }, MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS);
      conn.once(MC_RESP_SENT, onSent);
      conn.once(MC_RESP_ERR, onErr);
      void sendFrame().catch((err: unknown) => {
        cleanup();
        reject(unknownToError(err, 'send request failed'));
      });
    });
  });
}
