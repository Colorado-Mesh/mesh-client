import { EventEmitter } from 'events';
import tls from 'tls';

import type { TAKRemoteStatus } from '../../shared/tak-types';
import { MS_PER_SECOND } from '../../shared/timeConstants';
import { sanitizeLogMessage } from '../log-service';
import type { TakRemoteCredentials } from './remote-credentials';
import { tlsConnectHost } from './remote-settings';

/** Give up on a TCP+TLS handshake that has not finished in this long. */
export const TAK_REMOTE_CONNECT_TIMEOUT_MS = 15 * MS_PER_SECOND;
/** First reconnect delay; doubles per failed attempt up to the max. */
export const TAK_REMOTE_RECONNECT_BASE_MS = MS_PER_SECOND;
export const TAK_REMOTE_RECONNECT_MAX_MS = 30 * MS_PER_SECOND;
/** TCP keepalive so a NAT or firewall does not silently drop an idle stream. */
const TAK_REMOTE_KEEPALIVE_MS = 60 * MS_PER_SECOND;
/**
 * A stream must stay up this long before the reconnect backoff resets. Under TLS 1.3 the server
 * checks the client certificate after the client's handshake has finished, so a rejected
 * certificate looks like a connection that closes moments later.
 */
export const TAK_REMOTE_STABLE_MS = 10 * MS_PER_SECOND;
/**
 * Stop queueing CoT once this much is waiting on a slow server; the replicator re-sends every
 * node on its refresh cycle, so dropped events recover without growing memory.
 */
export const TAK_REMOTE_MAX_BUFFERED_BYTES = 1024 * 1024;

export interface TakRemoteClientOptions {
  host: string;
  port: number;
  verifyServer: boolean;
  /** See TAKRemoteSettings.allowNameMismatch; only honored with an imported CA. */
  allowNameMismatch: boolean;
  credentials: TakRemoteCredentials;
}

type ConnectFn = (options: tls.ConnectionOptions) => tls.TLSSocket;

const UNTRUSTED_SERVER = "The server certificate is not trusted; import the server's CA";

/** Plain-language status text for the socket and certificate errors a TAK user can act on. */
const SOCKET_ERROR_TEXT: Record<string, string> = {
  ECONNREFUSED: 'Connection refused; check the server address and port',
  ENOTFOUND: 'Server address not found',
  EAI_AGAIN: 'Server address could not be resolved',
  ETIMEDOUT: 'Connection timed out',
  EHOSTUNREACH: 'Server unreachable',
  ENETUNREACH: 'Network unreachable',
  ECONNRESET: 'Connection reset by the server',
  DEPTH_ZERO_SELF_SIGNED_CERT: UNTRUSTED_SERVER,
  SELF_SIGNED_CERT_IN_CHAIN: UNTRUSTED_SERVER,
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: UNTRUSTED_SERVER,
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: UNTRUSTED_SERVER,
  CERT_HAS_EXPIRED: 'The server certificate has expired',
  ERR_TLS_CERT_ALTNAME_INVALID:
    'The server certificate is for a different name; allow a name mismatch if this TAK server is set up that way',
};

/**
 * Turn a socket error into status text. OpenSSL errors arrive as
 * `<id>:error:<code>:SSL routines:<fn>:<reason>:<file>:<line>`; only the reason is useful.
 */
export function describeTakRemoteError(err: NodeJS.ErrnoException): string {
  const known = err.code ? SOCKET_ERROR_TEXT[err.code] : undefined;
  if (known) return known;
  const reason = /error:[0-9A-F]+:[^:]*:[^:]*:([^:]+)/i.exec(err.message)?.[1]?.trim();
  if (!reason) return err.message;
  if (reason.includes('certificate required')) {
    return 'The server requires a client certificate; import one';
  }
  if (/alert (bad certificate|unknown ca|certificate unknown|certificate revoked)/.test(reason)) {
    return `The server rejected the client certificate (${reason})`;
  }
  return reason;
}

/**
 * One TLS stream to a remote TAK server. Sends newline-terminated CoT (the same format the
 * local server writes) and discards whatever the server sends back. Reconnects with capped
 * exponential backoff until {@link stop} is called; a manual stop never reconnects.
 *
 * Emits `status` (TAKRemoteStatus) on every state change and `connected` after each successful
 * handshake so the owner can flush its node cache.
 */
export class TakRemoteClient extends EventEmitter {
  private socket: tls.TLSSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private failedAttempts = 0;
  private stopped = true;
  private status: TAKRemoteStatus;

  constructor(
    private readonly options: TakRemoteClientOptions,
    private readonly connectFn: ConnectFn = tls.connect,
  ) {
    super();
    this.status = { state: 'disconnected', host: options.host, port: options.port };
  }

  getStatus(): TAKRemoteStatus {
    return { ...this.status };
  }

  isConnected(): boolean {
    return this.status.state === 'connected';
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    this.setStatus({ state: 'disconnected', host: this.options.host, port: this.options.port });
  }

  /** Write one CoT event. Returns false when it was not sent (not connected or backed up). */
  write(cot: string): boolean {
    const socket = this.socket;
    if (!socket || !this.isConnected()) return false;
    if (socket.writableLength > TAK_REMOTE_MAX_BUFFERED_BYTES) return false;
    socket.write(cot + '\n');
    return true;
  }

  private setStatus(status: TAKRemoteStatus): void {
    this.status = status;
    this.emit('status', this.getStatus());
  }

  private open(): void {
    const { host, port, verifyServer, allowNameMismatch, credentials } = this.options;
    // The name check is skipped only on request, and only when trust is pinned to an imported
    // CA: TAK servers are often issued a certificate for a name like "takserver" while clients
    // dial an IP, and ATAK does not check the name. Against the system roots it always applies.
    const skipNameCheck = verifyServer && allowNameMismatch && Boolean(credentials.ca);
    this.setStatus({ ...this.status, state: 'connecting', connectedAt: undefined });
    console.debug(`[TakRemote] Connecting to ${sanitizeLogMessage(host)}:${port}`);

    let socket: tls.TLSSocket;
    try {
      socket = this.connectFn({
        host: tlsConnectHost(host),
        port,
        ca: credentials.ca,
        cert: credentials.cert,
        key: credentials.key,
        rejectUnauthorized: verifyServer,
        ...(skipNameCheck ? { checkServerIdentity: () => undefined } : {}),
      });
    } catch (err) {
      // tls.connect throws synchronously on unusable credentials; retrying cannot fix that.
      const error = sanitizeLogMessage(err instanceof Error ? err.message : String(err));
      console.warn(`[TakRemote] Cannot connect to ${sanitizeLogMessage(host)}:${port}: ${error}`);
      this.stopped = true;
      this.setStatus({ state: 'disconnected', host, port, error });
      return;
    }
    this.socket = socket;
    let lastError: string | undefined;
    let secureAt = 0;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;

    socket.setTimeout(TAK_REMOTE_CONNECT_TIMEOUT_MS);
    socket.once('timeout', () => {
      socket.destroy(new Error('connection timed out'));
    });
    socket.once('secureConnect', () => {
      socket.setTimeout(0);
      socket.setKeepAlive(true, TAK_REMOTE_KEEPALIVE_MS);
      secureAt = Date.now();
      stableTimer = setTimeout(() => {
        this.failedAttempts = 0;
      }, TAK_REMOTE_STABLE_MS);
      this.setStatus({ state: 'connected', host, port, connectedAt: Date.now() });
      console.debug(`[TakRemote] Connected to ${sanitizeLogMessage(host)}:${port}`);
      this.emit('connected');
    });
    // Servers stream other users' CoT back; read and drop it so their send buffer never fills.
    socket.resume();
    socket.on('error', (err: NodeJS.ErrnoException) => {
      lastError = sanitizeLogMessage(describeTakRemoteError(err));
      console.warn(
        `[TakRemote] ${sanitizeLogMessage(host)}:${port} error: ${sanitizeLogMessage(err.message)}`,
      );
    });
    socket.once('close', () => {
      if (stableTimer) clearTimeout(stableTimer);
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      const closedAfterHandshake = secureAt > 0 && Date.now() - secureAt < TAK_REMOTE_STABLE_MS;
      this.scheduleReconnect(
        lastError ??
          (closedAfterHandshake
            ? 'The server closed the connection right after the TLS handshake; it may not accept the client certificate'
            : 'connection closed'),
      );
    });
  }

  private scheduleReconnect(error: string): void {
    const delay = Math.min(
      TAK_REMOTE_RECONNECT_BASE_MS * 2 ** this.failedAttempts,
      TAK_REMOTE_RECONNECT_MAX_MS,
    );
    this.failedAttempts++;
    this.setStatus({
      state: 'connecting',
      host: this.options.host,
      port: this.options.port,
      error,
    });
    console.debug(`[TakRemote] Reconnecting in ${delay} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open();
    }, delay);
  }
}
