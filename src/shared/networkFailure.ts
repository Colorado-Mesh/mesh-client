/** True when an error looks like missing/unreachable network (not a server/app bug). */
export function isNetworkClassFailure(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('ehostunreach') ||
    msg.includes('enetunreach') ||
    msg.includes('etimedout') ||
    msg.includes('getaddrinfo') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('internet') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('abort')
  );
}
