/** Race `promise` against a timeout; clears the timer when `promise` settles. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  // Swallow late rejects from the loser of the race so they cannot surface as
  // Unhandled rejection (SoftAP: tcp-write fails after timeout already won).
  void promise.then(
    () => undefined,
    () => undefined,
  );
  void timeoutPromise.then(
    () => undefined,
    () => undefined,
  );
  return Promise.race([
    promise.finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }),
    timeoutPromise,
  ]);
}
