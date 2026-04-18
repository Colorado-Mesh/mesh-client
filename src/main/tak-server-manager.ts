import { randomUUID } from 'crypto';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import tls from 'tls';

import type { MeshNode } from '../renderer/lib/types';
import type { TAKClientInfo, TAKServerStatus, TAKSettings } from '../shared/tak-types';
import { sanitizeLogMessage } from './log-service';
import { type CertBundle, loadOrGenerateCerts, regenerateCerts } from './tak/certificate-manager';
import { meshNodeToCot } from './tak/cot-converter';
import { generateDataPackage } from './tak/data-package';

interface ConnectedClient {
  socket: tls.TLSSocket;
  info: TAKClientInfo;
  buffer: string;
}

const NODE_CACHE_MAX_SIZE = 2000;

export class TakServerManager extends EventEmitter {
  private server: tls.Server | null = null;
  private clients = new Map<string, ConnectedClient>();
  private settings: TAKSettings | null = null;
  private nodeCache = new Map<number, MeshNode>();
  private certBundle: CertBundle | null = null;
  private _status: TAKServerStatus = { running: false, port: 8089, clientCount: 0 };

  private get settingsPath(): string {
    return path.join(app.getPath('userData'), 'tak-settings.json');
  }

  getStatus(): TAKServerStatus {
    return { ...this._status };
  }

  getConnectedClients(): TAKClientInfo[] {
    return Array.from(this.clients.values()).map((c) => ({ ...c.info }));
  }

  async start(settings: TAKSettings): Promise<void> {
    if (this.server) {
      this.stop();
    }

    this.settings = settings;
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));

    try {
      this.certBundle = await loadOrGenerateCerts(settings.serverName);
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
      console.error('[TakServer]', msg);
      this._status = { running: false, port: settings.port, clientCount: 0, error: msg };
      this.emit('status', this.getStatus());
      this.emit('error', msg);
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

  private pruneNodeCache(): void {
    if (this.nodeCache.size <= NODE_CACHE_MAX_SIZE) return;
    const sorted = [...this.nodeCache.entries()].sort((a, b) => a[1].last_heard - b[1].last_heard);
    const toRemove = sorted.slice(0, this.nodeCache.size - NODE_CACHE_MAX_SIZE);
    for (const [id] of toRemove) this.nodeCache.delete(id);
  }

  onNodeUpdate(node: Partial<MeshNode> & { node_id: number }): void {
    const existing = this.nodeCache.get(node.node_id) ?? ({} as MeshNode);
    const merged = { ...existing, ...node } as MeshNode;
    this.nodeCache.set(node.node_id, merged);
    this.pruneNodeCache();

    if (merged.latitude == null || merged.longitude == null) return;
    if (this.clients.size === 0) return;

    const cot = meshNodeToCot(merged);
    if (!cot) return;

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

  async generateDataPackage(): Promise<string> {
    if (!this.certBundle || !this.settings) {
      throw new Error('TAK server must be started before generating a data package');
    }
    return generateDataPackage(this.certBundle, this.settings);
  }

  async regenerateCertificates(): Promise<void> {
    const serverName = this.settings?.serverName ?? 'mesh-client';
    const wasRunning = this._status.running;

    if (wasRunning) this.stop();
    this.certBundle = await regenerateCerts(serverName);
    if (wasRunning && this.settings) {
      await this.start(this.settings);
    }
  }

  private _handleClient(socket: tls.TLSSocket): void {
    const id = randomUUID();
    const address = socket.remoteAddress ?? 'unknown';
    const info: TAKClientInfo = { id, address, connectedAt: Date.now() };
    const client: ConnectedClient = { socket, info, buffer: '' };
    this.clients.set(id, client);

    this._status = { ...this._status, clientCount: this.clients.size };
    this.emit('client-connected', { ...info });
    this.emit('status', this.getStatus());
    console.debug(`[TakServer] Client connected: ${address} (${id})`);

    // Flush cached node positions to new client
    for (const node of this.nodeCache.values()) {
      if (node.latitude == null || node.longitude == null) continue;
      const cot = meshNodeToCot(node);
      if (!cot) continue;
      try {
        socket.write(cot + '\n');
      } catch {
        // catch-no-log-ok: socket may close between connection and flush; not actionable
      }
    }

    socket.on('data', (chunk: Buffer) => {
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
