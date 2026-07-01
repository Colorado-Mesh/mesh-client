import { type ChildProcess, spawn } from 'child_process';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import net from 'net';
import path from 'path';
import WebSocket from 'ws';

import type {
  ReticulumSidecarStartOptions,
  ReticulumSidecarStatus,
  ReticulumStatusResponse,
} from '../shared/reticulum-types';
import { MS_PER_SECOND } from '../shared/timeConstants';
import { sanitizeLogMessage } from './log-service';
import { assertReticulumProxyPath, reticulumProxyGetTimeoutMs } from './reticulum-proxy-path';
import { ensureDevSidecarBinary, resolveSidecarBinaryPath } from './reticulum-sidecar-path';

const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_POLL_TIMEOUT_MS = 30 * MS_PER_SECOND;
const STOP_GRACE_MS = 5 * MS_PER_SECOND;

async function findFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function pollSidecarHealth(port: number): Promise<ReticulumStatusResponse> {
  const url = `http://127.0.0.1:${port}/api/v1/status`;
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  let lastError = 'health poll timeout';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (!res.ok) {
        lastError = `status ${res.status}`;
      } else {
        const body = (await res.json()) as ReticulumStatusResponse;
        if (body.status === 'ok') return body;
        lastError = `unexpected status field: ${body.status}`;
      }
    } catch (err) {
      // catch-no-log-ok: health poll retries until deadline; lastError surfaces on timeout
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(lastError);
}

export class ReticulumSidecarManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private ws: { close: () => void } | null = null;
  private _status: ReticulumSidecarStatus = {
    running: false,
    port: 0,
    pid: null,
  };

  resolveBinaryPath(): string {
    return resolveSidecarBinaryPath();
  }

  getStatus(): ReticulumSidecarStatus {
    return { ...this._status };
  }

  private reticulumUserDir(...segments: string[]): string {
    return path.join(app.getPath('userData'), 'reticulum', ...segments);
  }

  async start(opts: ReticulumSidecarStartOptions = {}): Promise<ReticulumSidecarStatus> {
    if (opts.reuseIfRunning && this._status.running && this.proc) {
      try {
        await pollSidecarHealth(this._status.port);
        return this.getStatus();
      } catch {
        // catch-no-log-ok: reuseIfRunning health failed — stop stale process and start fresh
        await this.stop();
      }
    }

    if (this.proc) {
      await this.stop();
    }

    const configDir = this.reticulumUserDir('config');
    const storageDir = this.reticulumUserDir('storage');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(storageDir, { recursive: true });

    const port = await findFreePort();
    const binary = this.resolveBinaryPath();
    try {
      await ensureDevSidecarBinary(binary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }
    if (!fs.existsSync(binary)) {
      const msg = `Reticulum sidecar binary not found: ${binary}. Run \`pnpm run reticulum:sidecar:build\` from the repo root (requires Rust).`;
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }

    const args = [
      '--headless',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--reticulum-config-dir',
      configDir,
      '--storage-dir',
      storageDir,
    ];

    const proc = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.proc = proc;

    proc.stdout?.on('data', (chunk: Buffer) => {
      console.debug('[ReticulumSidecar]', sanitizeLogMessage(chunk.toString('utf8').trim()));
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      console.warn('[ReticulumSidecar]', sanitizeLogMessage(chunk.toString('utf8').trim()));
    });
    proc.on('exit', (code, signal) => {
      console.debug(`[ReticulumSidecar] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.teardownWs();
      this.proc = null;
      this._status = {
        running: false,
        port: this._status.port,
        pid: null,
        lastError: code != null && code !== 0 ? `exit ${code}` : undefined,
      };
      this.emit('status', this.getStatus());
    });

    try {
      await pollSidecarHealth(port);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.stop();
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }

    this._status = {
      running: true,
      port,
      pid: proc.pid ?? null,
    };
    this.connectWs(port);
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  async stop(): Promise<void> {
    this.teardownWs();
    const proc = this.proc;
    this.proc = null;
    if (!proc) {
      this._status = { running: false, port: 0, pid: null };
      this.emit('status', this.getStatus());
      return;
    }

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // catch-no-log-ok: process may already be gone during forced shutdown
        }
        resolve();
      }, STOP_GRACE_MS);

      proc.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });

      try {
        proc.kill('SIGTERM');
      } catch {
        // catch-no-log-ok: process may already be gone when sending SIGTERM
        clearTimeout(killTimer);
        resolve();
      }
    });

    this._status = { running: false, port: 0, pid: null };
    this.emit('status', this.getStatus());
  }

  async proxyGet(apiPath: string): Promise<unknown> {
    const status = this.getStatus();
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath);
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      signal: AbortSignal.timeout(reticulumProxyGetTimeoutMs(apiPath)),
    });
    if (!res.ok) {
      throw new Error(`sidecar GET ${normalized} failed: ${res.status}`);
    }
    return res.json();
  }

  async proxyPost(apiPath: string, body: unknown): Promise<unknown> {
    const status = this.getStatus();
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath);
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`sidecar POST ${normalized} failed: ${res.status}`);
    }
    return res.json();
  }

  async proxyPut(apiPath: string, body: unknown): Promise<unknown> {
    const status = this.getStatus();
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath);
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`sidecar PUT ${normalized} failed: ${res.status}`);
    }
    return res.json();
  }

  async proxyDelete(apiPath: string): Promise<unknown> {
    const status = this.getStatus();
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath);
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`sidecar DELETE ${normalized} failed: ${res.status}`);
    }
    const text = await res.text();
    if (!text) return { ok: true };
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // catch-no-log-ok: empty or non-JSON DELETE body is treated as success
      return { ok: true };
    }
  }

  private connectWs(port: number): void {
    this.teardownWs();
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      socket.on('message', (data: Buffer) => {
        const text = data.toString('utf8');
        try {
          const parsed = JSON.parse(text) as { type?: string; payload?: unknown };
          this.emit('event', {
            type: parsed.type ?? 'message',
            payload: parsed.payload ?? parsed,
          });
        } catch {
          // catch-no-log-ok: non-JSON ws payloads are forwarded as raw text events
          this.emit('event', { type: 'message', payload: text });
        }
      });
      socket.on('error', (err: Error) => {
        console.warn('[ReticulumSidecar] ws error:', sanitizeLogMessage(err.message));
      });
      this.ws = {
        close: () => {
          try {
            socket.close();
          } catch {
            // catch-no-log-ok: socket may already be closed
          }
        },
      };
    } catch (err) {
      console.warn(
        '[ReticulumSidecar] ws bridge unavailable:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  private teardownWs(): void {
    this.ws?.close();
    this.ws = null;
  }
}
