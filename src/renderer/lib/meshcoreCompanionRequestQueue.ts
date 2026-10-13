import { type MeshcoreRadioConnection, unknownToError } from './meshcoreRepeaterRpcCommon';

const tails = new WeakMap<MeshcoreRadioConnection, Promise<void>>();

/**
 * Companion login/status/telemetry/binary requests share one pending response slot.
 * Keep ownership through the remote reply; the separate SENT queue remains free
 * for CLI messages, trace sends and waiting-message polls.
 */
export function runMeshcoreCompanionRequest<T>(
  conn: MeshcoreRadioConnection,
  request: () => Promise<T>,
  options?: { signal?: AbortSignal; abortMessage?: string },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const signal = options?.signal;
    const previous = tails.get(conn);
    let release: () => void = () => undefined;
    const slot = new Promise<void>((done) => {
      release = done;
    });
    tails.set(conn, slot);
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      reject(new DOMException(options?.abortMessage ?? 'Request cancelled', 'AbortError'));
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    const finish = () => {
      if (tails.get(conn) === slot) tails.delete(conn);
      release();
    };
    const start = () => {
      signal?.removeEventListener('abort', onAbort);
      if (cancelled) {
        finish();
        return;
      }
      try {
        void request().then(
          (value) => {
            resolve(value);
            finish();
          },
          (error: unknown) => {
            reject(unknownToError(error, 'companion request failed'));
            finish();
          },
        );
      } catch (error) {
        // catch-no-log-ok request setup errors propagate to the caller
        reject(unknownToError(error, 'companion request setup failed'));
        finish();
      }
    };
    if (previous) void previous.then(start);
    else start();
  });
}
