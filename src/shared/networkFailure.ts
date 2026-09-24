/** True when an error looks like missing/unreachable network (not a server/app bug). */
export function isNetworkClassFailure(err: unknown): boolean {
  for (const msg of collectErrorMessages(err)) {
    if (messageLooksNetworkClass(msg)) return true;
  }
  return false;
}

function collectErrorMessages(err: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    if (typeof cur === 'string') {
      out.push(cur);
      break;
    }
    if (cur instanceof Error) {
      out.push(cur.message);
      // Node fetch often wraps DNS/connect failures: AbortError / TypeError + cause.code
      const withCause = cur as Error & { cause?: unknown; code?: unknown };
      if (typeof withCause.code === 'string') out.push(withCause.code);
      cur = withCause.cause;
      continue;
    }
    if (typeof cur === 'object') {
      const o = cur as { message?: unknown; code?: unknown; cause?: unknown };
      if (typeof o.message === 'string') out.push(o.message);
      if (typeof o.code === 'string') out.push(o.code);
      cur = o.cause;
      continue;
    }
    break;
  }
  return out;
}

function messageLooksNetworkClass(raw: string): boolean {
  const msg = raw.toLowerCase();
  if (
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
    msg.includes('timeout')
  ) {
    return true;
  }
  // Explicit abort/timeout cancellation — not unrelated strings containing "abort"
  if (/\baborted\b/.test(msg) || /\bcancel(?:led|ed)\b/.test(msg)) return true;
  if (msg.includes('timeouterror') || msg.includes('aborterror')) return true;
  return false;
}
