import {
  type MeshcoreRepeaterQueuedSendResult,
  waitForMeshcoreRadioSentAck,
} from './meshcoreRadioSentWait';
import { type MeshcoreRadioConnection } from './meshcoreRepeaterRpcCommon';

export type MeshcoreRepeaterRunSerialized = <T>(fn: () => Promise<T>) => Promise<T>;

export type { MeshcoreRepeaterQueuedSendResult };

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
  /** Invoked synchronously when RESP_SENT arrives, before the returned promise resolves. */
  onSentAck?: (result: MeshcoreRepeaterQueuedSendResult) => void,
): Promise<MeshcoreRepeaterQueuedSendResult> {
  return runSerialized(async () => {
    if (beforeSend) {
      await beforeSend();
    }
    return waitForMeshcoreRadioSentAck(conn, sendFrame, { onSentAck });
  });
}
