/**
 * Serialize MeshCore repeater-facing RPCs (tracePath, getStatus, sendBinaryRequest, CLI, etc.).
 * @liamcottle/meshcore.js registers `once(ResponseCodes.Sent)` / binary listeners per call; concurrent
 * overlapping calls can mis-attribute Sent/BinaryResponse to the wrong promise and surface as timeouts.
 */
export function createRepeaterRemoteRpcQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();

  return function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = tail.then(() => fn());
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}
