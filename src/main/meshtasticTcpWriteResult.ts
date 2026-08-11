/** Minimal Node socket fields used to classify expected TCP write races. */
export interface MeshtasticTcpWriteSocket {
  destroyed: boolean;
  writableEnded: boolean;
}

/**
 * True when a write failed because the socket was already gone (reconnect race).
 * Callers should resolve the IPC handler as `'no-socket'` instead of rejecting.
 */
export function meshtasticTcpWriteErrorIsNoSocket(
  sock: MeshtasticTcpWriteSocket,
  err: NodeJS.ErrnoException,
): boolean {
  if (sock.destroyed || sock.writableEnded) return true;
  const code = err.code;
  if (
    code === 'EPIPE' ||
    code === 'ECONNRESET' ||
    code === 'ERR_STREAM_DESTROYED' ||
    code === 'ERR_SOCKET_CLOSED'
  ) {
    return true;
  }
  const msg = err.message.toLowerCase();
  return (
    msg.includes('this socket has been destroyed') ||
    msg.includes('write after end') ||
    msg.includes('ended by the other party')
  );
}
