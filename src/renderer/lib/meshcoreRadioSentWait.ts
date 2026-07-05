import {
  MC_RESP_ERR,
  MC_RESP_SENT,
  type MeshcoreRadioConnection,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import { MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS } from './timeConstants';

export interface MeshcoreRepeaterQueuedSendResult {
  estTimeoutMs: number;
  expectedAckCrc?: number;
}

export interface MeshcoreRadioSentWaitOptions {
  timeoutMs?: number;
  rejectSentMsg?: string;
  rejectErrMsg?: string;
  /** Invoked synchronously when RESP_SENT arrives, before the returned promise resolves. */
  onSentAck?: (result: MeshcoreRepeaterQueuedSendResult) => void;
}

/**
 * Wait for RESP_SENT (or RESP_ERR) after invoking send().
 * Shared by companion queued send and trace multiplex send paths.
 */
export function waitForMeshcoreRadioSentAck(
  conn: MeshcoreRadioConnection,
  send: () => Promise<void>,
  opts?: MeshcoreRadioSentWaitOptions,
): Promise<MeshcoreRepeaterQueuedSendResult> {
  const timeoutMs = opts?.timeoutMs ?? MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS;
  const rejectSentMsg = opts?.rejectSentMsg ?? 'timeout waiting for sent acknowledgment';
  const rejectErrMsg = opts?.rejectErrMsg ?? 'radio rejected request';

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
      const result: MeshcoreRepeaterQueuedSendResult = {
        estTimeoutMs: r.estTimeout ?? 0,
        expectedAckCrc: r.expectedAckCrc,
      };
      opts?.onSentAck?.(result);
      resolve(result);
    };
    const onErr = (): void => {
      cleanup();
      reject(new Error(rejectErrMsg));
    };
    sentWaitTimer = setTimeout(() => {
      cleanup();
      reject(new Error(rejectSentMsg));
    }, timeoutMs);
    conn.once(MC_RESP_SENT, onSent);
    conn.once(MC_RESP_ERR, onErr);
    void send().catch((err: unknown) => {
      cleanup();
      reject(unknownToError(err, 'send request failed'));
    });
  });
}
