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
 * Stop queueing CoT once this much is waiting on a slow server; the replicator re-sends every
 * node on its refresh cycle, so dropped events recover without growing memory.
 */
export const TAK_REMOTE_MAX_BUFFERED_BYTES = 1024 * 1024;

export interface TakRemoteClientOptions {
  host: string;
  port: number;
  verifyServer: boolean;
  credentials: TakRemoteCredentials;
}

type ConnectFn = (options: tls.ConnectionOptions) => tls.TLSSocket;

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
    const { host, port, verifyServer, credentials } = this.options;
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
        // With an imported CA the chain is pinned to that CA and the hostname is not checked:
        // TAK server certificates are usually issued for a name like "takserver" while clients
        // dial an IP, and ATAK does not check it either. Without a CA, Node's default check
        // (system roots plus hostname) applies.
        ...(credentials.ca ? { checkServerIdentity: () => undefined } : {}),
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

    socket.setTimeout(TAK_REMOTE_CONNECT_TIMEOUT_MS);
    socket.once('timeout', () => {
      socket.destroy(new Error('connection timed out'));
    });
    socket.once('secureConnect', () => {
      socket.setTimeout(0);
      socket.setKeepAlive(true, TAK_REMOTE_KEEPALIVE_MS);
      this.failedAttempts = 0;
      this.setStatus({ state: 'connected', host, port, connectedAt: Date.now() });
      console.debug(`[TakRemote] Connected to ${sanitizeLogMessage(host)}:${port}`);
      this.emit('connected');
    });
    // Servers stream other users' CoT back; read and drop it so their send buffer never fills.
    socket.resume();
    socket.on('error', (err) => {
      lastError = sanitizeLogMessage(err.message);
      console.warn(`[TakRemote] ${sanitizeLogMessage(host)}:${port} error: ${lastError}`);
    });
    socket.once('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      this.scheduleReconnect(lastError ?? 'connection closed');
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
