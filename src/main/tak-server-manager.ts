import { randomUUID } from 'crypto';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import tls from 'tls';

import type { MeshNode } from '../renderer/lib/types';
import type { MeshProtocol } from '../shared/meshProtocol';
import type {
  TAKClientInfo,
  TAKRemoteSettings,
  TAKRemoteStatus,
  TAKServerStatus,
  TAKSettings,
} from '../shared/tak-types';
import { sanitizeLogMessage } from './log-service';
import {
  type CertBundle,
  loadOrGenerateCerts,
  regenerateCerts,
  type TakServerIdentity,
} from './tak/certificate-manager';
import { COT_STALE_MS, meshNodeToCot } from './tak/cot-converter';
import { generateDataPackage } from './tak/data-package';
import { getLanIp } from './tak/lan-ip';
import { TakRemoteClient } from './tak/remote-client';
import { loadTakRemoteCredentials } from './tak/remote-credentials';
import { DEFAULT_TAK_REMOTE_PORT, saveTakRemoteSettings } from './tak/remote-settings';

interface ConnectedClient {
  socket: tls.TLSSocket;
  info: TAKClientInfo;
  buffer: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** A node update from any protocol feed; `protocol` defaults to Meshtastic (MQTT feed). */
export type TakNodeUpdate = Partial<MeshNode> & { node_id: number; protocol?: MeshProtocol };

interface CachedTakNode extends MeshNode {
  protocol: MeshProtocol;
  /** When this entry last received an update, by the main-process clock. */
  cachedAtMs: number;
}

const NODE_CACHE_MAX_SIZE = 2000;
/** Local ATAK/iTAK connections; cap prevents unbounded TLS client growth. */
const MAX_TAK_CLIENTS = 16;
/** Disconnect idle clients after 24h without inbound data. */
const TAK_CLIENT_IDLE_MS = 24 * 60 * 60 * 1000;

export class TakServerManager extends EventEmitter {
  private server: tls.Server | null = null;
  private clients = new Map<string, ConnectedClient>();
  private settings: TAKSettings | null = null;
  /** Keyed by `${protocol}:${node_id}`; node ids from different protocols can collide. */
  private nodeCache = new Map<string, CachedTakNode>();
  private certBundle: CertBundle | null = null;
  private _status: TAKServerStatus = { running: false, port: 8089, clientCount: 0 };
  private remote: TakRemoteClient | null = null;
  private remoteSettings: TAKRemoteSettings | null = null;
  private remoteStatus: TAKRemoteStatus = {
    state: 'disconnected',
    host: '',
    port: DEFAULT_TAK_REMOTE_PORT,
  };

  private get settingsPath(): string {
    return path.join(app.getPath('userData'), 'tak-settings.json');
  }

  getStatus(): TAKServerStatus {
    return { ...this._status };
  }

  /** True while node updates have somewhere to go; the IPC feed skips them otherwise. */
  hasActiveSink(): boolean {
    return this._status.running || this.remote !== null;
  }

  getRemoteStatus(): TAKRemoteStatus {
    return { ...this.remoteStatus };
  }

  /**
   * Start (or restart with new settings) the relay to a remote TAK server. Credentials are read
   * from disk here, so an import takes effect on the next start. The relay is independent of
   * the local server: either can run without the other.
   * Throws, leaving any running relay untouched, when the stored credentials cannot be read.
   */
  startRemote(settings: TAKRemoteSettings): void {
    const credentials = loadTakRemoteCredentials();
    saveTakRemoteSettings(settings);
    this.stopRemote();
    this.remoteSettings = settings;
    const remote = new TakRemoteClient({
      host: settings.host.trim(),
      port: settings.port,
      verifyServer: settings.verifyServer,
      allowNameMismatch: settings.allowNameMismatch,
      credentials,
    });
    remote.on('status', (status: TAKRemoteStatus) => {
      this.remoteStatus = status;
      // The client only reports disconnected once it has stopped for good (unusable
      // credentials); stopRemote() detaches it before stopping, so this is that case.
      if (status.state === 'disconnected' && this.remote === remote) this.remote = null;
      this.emit('remote-status', { ...status });
    });
    remote.on('connected', () => {
      this.forEachFreshCot((cot) => remote.write(cot));
    });
    this.remote = remote;
    remote.start();
  }

  /** Reconnect a running relay so newly imported credentials replace the ones it holds. */
  restartRemote(): void {
    if (this.remote && this.remoteSettings) this.startRemote(this.remoteSettings);
  }

  stopRemote(): void {
    const remote = this.remote;
    if (!remote) return;
    this.remote = null;
    remote.stop();
    remote.removeAllListeners();
  }

  getConnectedClients(): TAKClientInfo[] {
    return Array.from(this.clients.values()).map((c) => ({ ...c.info }));
  }

  /** Server cert identity: UI server name + current LAN IP for EUD hostname checks. */
  private resolveServerIdentity(serverName: string): TakServerIdentity {
    return { serverName, ipAddresses: [getLanIp()] };
  }

  async start(settings: TAKSettings): Promise<void> {
    if (this.server) {
      this.stop();
    }

    this.settings = settings;
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));

    try {
      this.certBundle = await loadOrGenerateCerts(this.resolveServerIdentity(settings.serverName));
    } catch (err) {
      const msg = `Certificate generation failed: ${String(err)}`;
      this._status = { running: false, port: settings.port, clientCount: 0, error: msg };
      this.emit('status', this.getStatus());
      throw new Error(msg);
    }

    const serverOptions: tls.TlsOptions = {
      cert: this.certBundle.serverCert,
      key: this.certBundle.serverKey,
      ca: this.certBundle.caCert,
      requestCert: settings.requireClientCert,
      rejectUnauthorized: settings.requireClientCert,
    };

    this.server = tls.createServer(serverOptions, (socket) => {
      this._handleClient(socket);
    });

    this.server.on('error', (err) => {
      const msg = `Server error: ${String(err)}`;
      const safe = sanitizeLogMessage(msg);
      console.error('[TakServer]', safe);
      this._status = { running: false, port: settings.port, clientCount: 0, error: safe };
      this.emit('status', this.getStatus());
      this.emit('error', safe);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(settings.port, () => {
        this._status = { running: true, port: settings.port, clientCount: 0 };
        this.emit('status', this.getStatus());
        console.debug(`[TakServer] Listening on port ${settings.port}`);
        resolve();
      });
      this.server!.once('error', reject);
    });
  }

  stop(): void {
    if (!this.server) return;

    for (const [id, client] of this.clients) {
      this.clearClientIdleTimer(client);
      try {
        client.socket.destroy();
      } catch {
        // catch-no-log-ok: socket may already be closed; destroy error is expected during shutdown
      }
      this.clients.delete(id);
    }

    this.server.close();
    this.server = null;
    this._status = { running: false, port: this.settings?.port ?? 8089, clientCount: 0 };
    this.emit('status', this.getStatus());
    console.debug('[TakServer] Stopped');
  }

  /**
   * Evict the least recently updated entries. onNodeUpdate re-inserts every key it touches, so
   * Map order is update order by the main-process clock. Feeds report last_heard in different
   * units (MQTT milliseconds, MeshCore and Reticulum seconds), so it cannot rank entries.
   */
  private pruneNodeCache(): void {
    for (const key of this.nodeCache.keys()) {
      if (this.nodeCache.size <= NODE_CACHE_MAX_SIZE) return;
      this.nodeCache.delete(key);
    }
  }

  onNodeUpdate(node: TakNodeUpdate): void {
    const protocol = node.protocol ?? 'meshtastic';
    const key = `${protocol}:${node.node_id}`;
    const existing = this.nodeCache.get(key) ?? ({} as CachedTakNode);
    const merged: CachedTakNode = { ...existing, ...node, protocol, cachedAtMs: Date.now() };
    this.nodeCache.delete(key);
    this.nodeCache.set(key, merged);
    this.pruneNodeCache();

    if (merged.latitude == null || merged.longitude == null) return;
    const remote = this.remote?.isConnected() ? this.remote : null;
    if (this.clients.size === 0 && !remote) return;

    const cot = meshNodeToCot(merged, protocol);
    if (!cot) return;
    remote?.write(cot);

    const data = cot + '\n';
    for (const [id, client] of this.clients) {
      try {
        client.socket.write(data);
      } catch (err) {
        console.warn(
          `[TakServer] Failed to write to client ${id}:`,
          sanitizeLogMessage(String(err)),
        );
      }
    }
  }

  /**
   * CoT for every cached node updated within the CoT stale window, for a sink that just
   * connected. Older entries would already have gone stale on a client that was connected all
   * along, so sending them now would present old positions as current.
   */
  private forEachFreshCot(send: (cot: string) => void): void {
    const cutoff = Date.now() - COT_STALE_MS;
    for (const node of this.nodeCache.values()) {
      if (node.cachedAtMs < cutoff) continue;
      const cot = meshNodeToCot(node, node.protocol);
      if (cot) send(cot);
    }
  }

  async generateDataPackage(): Promise<string> {
    if (!this.settings) {
      throw new Error('TAK server must be started before generating a data package');
    }
    // Align cert SAN with the LAN IP written into connection.pref (may regen + restart).
    const identity = this.resolveServerIdentity(this.settings.serverName);
    const previousServerCert = this.certBundle?.serverCert;
    this.certBundle = await loadOrGenerateCerts(identity);
    if (
      this._status.running &&
      previousServerCert &&
      previousServerCert !== this.certBundle.serverCert
    ) {
      await this.start(this.settings);
    }
    return generateDataPackage(this.certBundle, this.settings);
  }

  /**
   * Regenerates the TAK server's TLS certificate/key pair.
   *
   * Failure point: `regenerateCerts()` (crypto/fs failure) or the subsequent
   * `start()` (e.g. port bind failure) can throw after `stop()` has already
   * torn down the running server.
   * Fallback: on cert-gen failure, record an explicit error status instead of
   * leaving `{running:false}` unexplained; on restart failure after a
   * successful regen, retry once with the previous (still-valid) certificate
   * bundle so the server doesn't stay down solely because of the new pair.
   * Logging: failures are logged via `console.error`/`console.warn` with
   * sanitized messages before rethrowing, so the IPC caller/UI always learns
   * the concrete cause.
   */
  async regenerateCertificates(): Promise<void> {
    const serverName = this.settings?.serverName ?? 'mesh-client';
    const wasRunning = this._status.running;
    const previousCertBundle = this.certBundle;

    if (wasRunning) this.stop();

    let newCertBundle: CertBundle;
    try {
      newCertBundle = await regenerateCerts(this.resolveServerIdentity(serverName));
    } catch (err) {
      const msg = `Certificate regeneration failed: ${String(err)}`;
      console.error('[TakServer]', sanitizeLogMessage(msg));
      this._status = {
        running: false,
        port: this.settings?.port ?? this._status.port,
        clientCount: 0,
        error: msg,
      };
      this.emit('status', this.getStatus());
      throw err instanceof Error ? err : new Error(msg);
    }
    this.certBundle = newCertBundle;

    if (!wasRunning || !this.settings) return;

    try {
      await this.start(this.settings);
    } catch (startErr) {
      // start() already recorded a stopped+error status for this attempt.
      // Best-effort: fall back to the previous certificate bundle so a bad
      // new cert/key pair doesn't leave the server down when it was running
      // before regeneration was requested.
      if (previousCertBundle) {
        this.certBundle = previousCertBundle;
        try {
          await this.start(this.settings);
          console.warn(
            '[TakServer] Restart with regenerated certificates failed; restored previous certificate bundle and restarted',
          );
          return;
        } catch {
          // catch-no-log-ok: fallback restart failed too; start() already recorded status/error for this attempt
        }
      }
      throw startErr;
    }
  }

  private clearClientIdleTimer(client: ConnectedClient): void {
    if (client.idleTimer) {
      clearTimeout(client.idleTimer);
      client.idleTimer = null;
    }
  }

  private resetClientIdleTimer(id: string, client: ConnectedClient): void {
    this.clearClientIdleTimer(client);
    client.idleTimer = setTimeout(() => {
      console.debug(`[TakServer] Idle timeout disconnect: ${sanitizeLogMessage(id)}`);
      try {
        client.socket.destroy();
      } catch {
        // catch-no-log-ok: socket may already be closed
      }
    }, TAK_CLIENT_IDLE_MS);
  }

  private _handleClient(socket: tls.TLSSocket): void {
    const address = socket.remoteAddress ?? 'unknown';
    if (this.clients.size >= MAX_TAK_CLIENTS) {
      console.warn(
        `[TakServer] Client cap (${MAX_TAK_CLIENTS}) reached; rejecting ${sanitizeLogMessage(address)}`,
      );
      socket.destroy();
      return;
    }

    const id = randomUUID();
    const info: TAKClientInfo = { id, address, connectedAt: Date.now() };
    const client: ConnectedClient = { socket, info, buffer: '', idleTimer: null };
    this.clients.set(id, client);

    this._status = { ...this._status, clientCount: this.clients.size };
    this.emit('client-connected', { ...info });
    this.emit('status', this.getStatus());
    console.debug(`[TakServer] Client connected: ${address} (${id})`);

    this.forEachFreshCot((cot) => {
      try {
        socket.write(cot + '\n');
      } catch {
        // catch-no-log-ok: socket may close between connection and flush; not actionable
      }
    });

    this.resetClientIdleTimer(id, client);

    socket.on('data', (chunk: Buffer) => {
      this.resetClientIdleTimer(id, client);
      client.buffer += chunk.toString('utf-8');
      // Discard fully-received CoT events (Phase 5: bidirectional processing)
      const endIdx = client.buffer.lastIndexOf('</event>');
      if (endIdx >= 0) {
        client.buffer = client.buffer.slice(endIdx + 8);
      }
      // Cap buffer to prevent unbounded growth from malformed data
      if (client.buffer.length > 64 * 1024) {
        client.buffer = '';
      }
    });

    socket.on('close', () => {
      this.clearClientIdleTimer(client);
      this.clients.delete(id);
      this._status = { ...this._status, clientCount: this.clients.size };
      this.emit('client-disconnected', id);
      this.emit('status', this.getStatus());
      console.debug(`[TakServer] Client disconnected: ${address} (${id})`);
    });

    socket.on('error', () => {
      console.warn(`[TakServer] Client socket error ${sanitizeLogMessage(id)}: socket error`);
    });
  }
}
