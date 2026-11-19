/**
 * Recognizes best-effort socket QoS marking failures that must not crash the app.
 *
 * undici sets the IP ToS / DSCP byte on outbound HTTP/1.1 sockets via
 * `socket.setTypeOfService()` (available since Node 25.6). macOS rejects `IP_TOS` /
 * `IPV6_TCLASS` with EINVAL on some configurations (VPN, IPv6-only sockets, certain
 * firewall postures). The throw happens inside a socket `connect` listener, so it
 * escapes the caller's try/catch and reaches the global handlers in index.ts.
 * The byte is advisory and the socket still works, so the rejection is harmless.
 *
 * Matching is deliberately narrow: the syscall must be named AND EINVAL confirmed.
 * A present `code` is authoritative — anything other than EINVAL (EACCES, EPERM, …)
 * fails the match so real bugs keep the default crash path.
 */
export function isHarmlessSocketOptionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (!err.message.includes('setTypeOfService')) return false;

  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.length > 0) {
    return code === 'EINVAL';
  }
  return err.message.includes('EINVAL');
}

/**
 * Narrow global filter for console→stdio EPIPE (#1492). Requires EPIPE plus a
 * console/stdio stack frame so unhandled TCP/TAK write EPIPE still reports.
 * Inspects only stack-frame lines (skips V8's `Error: …` header).
 */
export function isHarmlessStdioBrokenPipeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  const epipe =
    code === 'EPIPE' ||
    ((code === undefined || code === '') &&
      (err.message === 'write EPIPE' || err.message.startsWith('write EPIPE')));
  if (!epipe) return false;
  const stack = err.stack ?? '';
  const nl = stack.indexOf('\n');
  return (
    nl !== -1 && /WriteToConsole|console\.(?:log|info|warn|error|debug)/.test(stack.slice(nl + 1))
  );
}
