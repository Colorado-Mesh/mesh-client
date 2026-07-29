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
import {
  RETICULUM_PROXY_MAX_BODY_BYTES,
  RETICULUM_PROXY_MAX_RESPONSE_BYTES,
  RETICULUM_WS_MAX_MESSAGE_BYTES,
} from '../shared/reticulumProxyLimits';
import { MS_PER_SECOND } from '../shared/timeConstants';
import { bleCoexistenceCoordinator } from './ble-coexistence-coordinator';
import { sanitizeLogMessage } from './log-service';
import { reticulumConfigDirHasEnabledBleRnode } from './reticulum-ble-rnode-config';
import { disableDecommissionedReticulumHubsInConfigDir } from './reticulum-decommissioned-hubs';
import {
  assertReticulumProxyPath,
  RETICULUM_FACTORY_RESET_PATH,
  reticulumProxyGetTimeoutMs,
} from './reticulum-proxy-path';
import { ensureDevSidecarBinary, resolveSidecarBinaryPath } from './reticulum-sidecar-path';
import { ReticulumSidecarAutoBeaconTracker } from './reticulumSidecarAutoBeaconTracker';
import { ReticulumSidecarInterfaceIssueTracker } from './reticulumSidecarIssueTracker';
import {
  logReticulumSidecarStderrLine,
  ReticulumSidecarStderrDedupe,
} from './reticulumSidecarStderrLog';
import { startSidecarWatchdog } from './reticulumSidecarWatchdog';

const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_POLL_TIMEOUT_MS = 30 * MS_PER_SECOND;
const STOP_GRACE_MS = 5 * MS_PER_SECOND;
/** After yielding Noble BLE, allow CoreBluetooth/btleplug to settle before sidecar connect. */
const RETICULUM_BLE_RNODE_NOBLE_SETTLE_MS = 500;

/** Minimal env for sidecar child processes (start + validate-config). */
export function sidecarChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR, // NOSONAR passthrough of existing env var only; no temp file write here
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
  };
  if (process.platform === 'win32') {
    env.APPDATA = process.env.APPDATA;
    env.USERPROFILE = process.env.USERPROFILE;
    env.LOCALAPPDATA = process.env.LOCALAPPDATA;
  }
  return env;
}

function assertProxyBodySize(body: unknown): void {
  const json = JSON.stringify(body ?? {});
  if (json.length > RETICULUM_PROXY_MAX_BODY_BYTES) {
    throw new Error('Reticulum proxy body too large');
  }
}

/**
 * Reads a fetch Response body up to `maxBytes` and returns it as text.
 * Rejects fast via Content-Length when present; otherwise streams with a
 * hard cap so a misbehaving sidecar can't balloon main-process memory or
 * fan out an oversized payload over IPC. Throws (does not silently
 * truncate) so callers never parse a partial/corrupt JSON response.
 */
async function readResponseTextUpTo(res: Response, maxBytes: number): Promise<string> {
  const contentLengthHeader = res.headers.get('content-length');
  if (contentLengthHeader != null) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`sidecar response exceeded ${maxBytes} byte cap`);
    }
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > maxBytes) {
      throw new Error(`sidecar response exceeded ${maxBytes} byte cap`);
    }
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.length;
      if (total > maxBytes) {
        throw new Error(`sidecar response exceeded ${maxBytes} byte cap`);
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // catch-no-log-ok: stream may already be closed/aborted by this point
    }
  }
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    merged.set(chunk, pos);
    pos += chunk.length;
  }
  return Buffer.from(merged).toString('utf8');
}

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
  private wsPort = 0;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectAttempt = 0;
  private startPromise: Promise<ReticulumSidecarStatus> | null = null;
  private readonly stderrDedupe = new ReticulumSidecarStderrDedupe();
  private readonly autoBeaconTracker = new ReticulumSidecarAutoBeaconTracker();
  private readonly interfaceIssueTracker = new ReticulumSidecarInterfaceIssueTracker();
  private lastIssueStatusEmitAt = 0;
  private watchdogStop: (() => void) | null = null;
  private _status: ReticulumSidecarStatus = {
    running: false,
    port: 0,
    pid: null,
    healthy: true,
  };

  resolveBinaryPath(): string {
    return resolveSidecarBinaryPath();
  }

  getStatus(): ReticulumSidecarStatus {
    return {
      ...this._status,
      autoBeaconAlert: this.autoBeaconTracker.getAlert(),
      interfaceIssueAlert: this.interfaceIssueTracker.getAlert(),
    };
  }

  /** Prune, mutate tracker, optionally emit status when alert changes (or throttle fires). */
  private mutateInterfaceIssues(
    mutate: () => void,
    opts: { alwaysEmitAfterMs?: number } = {},
  ): ReticulumSidecarStatus {
    this.interfaceIssueTracker.getAlert();
    const before = JSON.stringify(this.interfaceIssueTracker.peekAlert());
    mutate();
    this.interfaceIssueTracker.getAlert();
    const after = JSON.stringify(this.interfaceIssueTracker.peekAlert());
    const status = this.getStatus();
    const now = Date.now();
    const throttleDue =
      opts.alwaysEmitAfterMs != null && now - this.lastIssueStatusEmitAt >= opts.alwaysEmitAfterMs;
    if (before !== after || throttleDue) {
      this.lastIssueStatusEmitAt = now;
      this.emit('status', status);
    }
    return status;
  }

  private recordSidecarOutputLine(text: string): void {
    this.mutateInterfaceIssues(
      () => {
        this.interfaceIssueTracker.recordLine(text);
      },
      { alwaysEmitAfterMs: 5_000 },
    );
  }

  /**
   * Drop TCP/TX latch entries for interfaces that are disabled or missing from config.
   * Emits status when the alert changes so the Connection banner updates immediately.
   */
  syncInterfaceIssueScope(enabledInterfaceNames: readonly string[]): ReticulumSidecarStatus {
    return this.mutateInterfaceIssues(() => {
      this.interfaceIssueTracker.retainInterfaces(new Set(enabledInterfaceNames));
    });
  }

  private clearSidecarTrackers(): void {
    this.interfaceIssueTracker.clear();
    this.autoBeaconTracker.clear();
  }

  private finalizeStopped(): void {
    this.stopWatchdog();
    this.clearSidecarTrackers();
    this._status = { running: false, port: 0, pid: null, healthy: true, unhealthySince: undefined };
    this.emit('status', this.getStatus());
  }

  private reticulumUserDir(...segments: string[]): string {
    return path.join(app.getPath('userData'), 'reticulum', ...segments);
  }

  async start(opts: ReticulumSidecarStartOptions = {}): Promise<ReticulumSidecarStatus> {
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startOnce(opts).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startOnce(
    opts: ReticulumSidecarStartOptions = {},
  ): Promise<ReticulumSidecarStatus> {
    if (opts.reuseIfRunning && this._status.running && this.proc) {
      try {
        await pollSidecarHealth(this._status.port);
        return this.getStatus();
      } catch {
        // catch-no-log-ok: reuseIfRunning health failed — stop stale process and start fresh
        await this.stopProc();
      }
    }

    if (this.proc) {
      await this.stopProc();
    }

    const configDir = this.reticulumUserDir('config');
    const storageDir = this.reticulumUserDir('storage');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(storageDir, { recursive: true });

    const disabledDecommissioned = disableDecommissionedReticulumHubsInConfigDir(configDir);
    if (disabledDecommissioned.length > 0) {
      console.debug(
        '[ReticulumSidecar] disabled decommissioned testnet hubs:',
        disabledDecommissioned.join(', '),
      );
    }

    const needsBleRnodeNobleYield = reticulumConfigDirHasEnabledBleRnode(configDir);
    let nobleYieldHeldForStart = false;
    if (needsBleRnodeNobleYield) {
      await bleCoexistenceCoordinator.suspendNobleForReticulumBleConnect();
      nobleYieldHeldForStart = true;
      await new Promise((r) => setTimeout(r, RETICULUM_BLE_RNODE_NOBLE_SETTLE_MS));
    }

    const releaseNobleYieldOnStartFailure = (): void => {
      if (!nobleYieldHeldForStart) return;
      nobleYieldHeldForStart = false;
      bleCoexistenceCoordinator.releaseScan('reticulum');
    };

    const port = await findFreePort();
    const binary = this.resolveBinaryPath();
    try {
      await ensureDevSidecarBinary(binary);
    } catch (err) {
      releaseNobleYieldOnStartFailure();
      const msg = err instanceof Error ? err.message : String(err);
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }
    if (!fs.existsSync(binary)) {
      releaseNobleYieldOnStartFailure();
      const msg = app.isPackaged
        ? `RETICULUM_SIDECAR_BUNDLED_MISSING: packaged sidecar binary not found at ${binary}`
        : `Reticulum sidecar binary not found: ${binary}. Run \`pnpm run reticulum:sidecar:build\` from the repo root (requires Rust).`;
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
      env: sidecarChildEnv(),
    });
    this.proc = proc;

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = sanitizeLogMessage(chunk.toString('utf8').trim());
      this.recordSidecarOutputLine(text);
      console.debug('[ReticulumSidecar]', text);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = sanitizeLogMessage(chunk.toString('utf8').trim());
      this.recordSidecarOutputLine(text);
      logReticulumSidecarStderrLine(
        text,
        this.stderrDedupe,
        {
          warn: (message) => {
            console.warn('[ReticulumSidecar]', message);
          },
          debug: (message) => {
            console.debug('[ReticulumSidecar]', message);
          },
        },
        this.autoBeaconTracker,
      );
    });
    proc.on('exit', (code, signal) => {
      console.debug(`[ReticulumSidecar] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.teardownWs();
      this.proc = null;
      this.clearSidecarTrackers();
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
      releaseNobleYieldOnStartFailure();
      const msg = err instanceof Error ? err.message : String(err);
      await this.stopProc();
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }

    nobleYieldHeldForStart = false;

    this._status = {
      running: true,
      port,
      pid: proc.pid ?? null,
      healthy: true,
      unhealthySince: undefined,
    };
    this.connectWs(port);
    this.startWatchdog();
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogStop = startSidecarWatchdog({
      getPort: () => (this._status.running ? this._status.port : undefined),
      isProcessAlive: () => this.proc != null,
      onHealthChange: (healthy) => {
        const wasHealthy = this._status.healthy !== false;
        if (healthy === wasHealthy) return;
        this._status = {
          ...this._status,
          healthy,
          unhealthySince: healthy ? undefined : Date.now(),
        };
        this.emit('status', this.getStatus());
      },
      restartFn: async () => {
        // Hung-only: process still alive but HTTP dead. Renderer owns exit/crash reconnect.
        this.stopWatchdog();
        await this.stopProc();
        await this.start();
      },
    });
  }

  private stopWatchdog(): void {
    this.watchdogStop?.();
    this.watchdogStop = null;
  }

  async stop(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise.catch(() => {
        // catch-no-log-ok: in-flight start may fail; explicit stop still runs afterward
      });
    }
    await this.stopProc();
  }

  private async stopProc(): Promise<void> {
    this.stopWatchdog();
    this.teardownWs();
    if (bleCoexistenceCoordinator.getState().scanOwner === 'reticulum') {
      bleCoexistenceCoordinator.releaseScan('reticulum');
    }
    const proc = this.proc;
    this.proc = null;
    if (!proc) {
      this.finalizeStopped();
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

    this.finalizeStopped();
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
    const contentType = res.headers.get('content-type') ?? '';
    const text = await readResponseTextUpTo(res, RETICULUM_PROXY_MAX_RESPONSE_BYTES);
    if (!contentType.includes('application/json')) {
      if (!text) return { ok: true };
      try {
        return JSON.parse(text) as unknown;
      } catch {
        // catch-no-log-ok non-JSON GET body returned as plain text wrapper
        return { ok: true, body: text };
      }
    }
    if (!text) return {};
    return JSON.parse(text) as unknown;
  }

  async proxyPost(apiPath: string, body: unknown): Promise<unknown> {
    const status = this.getStatus();
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath);
    assertProxyBodySize(body);
    const pathOnly = normalized.split('?')[0] ?? normalized;
    // RRC connect includes path discovery + Link handshake + WELCOME wait.
    const postTimeoutMs = pathOnly === '/api/v1/rrc/connect' ? 60_000 : 30_000;
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(postTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`sidecar POST ${normalized} failed: ${res.status}`);
    }
    const text = await readResponseTextUpTo(res, RETICULUM_PROXY_MAX_RESPONSE_BYTES);
    return text ? (JSON.parse(text) as unknown) : {};
  }

  /** Dedicated factory-reset POST (blocked on the generic proxy path validator). */
  async factoryReset(): Promise<unknown> {
    const status = this.getStatus();
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(RETICULUM_FACTORY_RESET_PATH, {
      allowFactoryReset: true,
    });
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`sidecar POST ${normalized} failed: ${res.status}`);
    }
    const text = await readResponseTextUpTo(res, RETICULUM_PROXY_MAX_RESPONSE_BYTES);
    return text ? (JSON.parse(text) as unknown) : {};
  }

  async proxyPut(apiPath: string, body: unknown): Promise<unknown> {
    const status = this.getStatus();
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath);
    assertProxyBodySize(body);
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`sidecar PUT ${normalized} failed: ${res.status}`);
    }
    const text = await readResponseTextUpTo(res, RETICULUM_PROXY_MAX_RESPONSE_BYTES);
    return text ? (JSON.parse(text) as unknown) : {};
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
    const text = await readResponseTextUpTo(res, RETICULUM_PROXY_MAX_RESPONSE_BYTES);
    if (!text) return { ok: true };
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // catch-no-log-ok: empty or non-JSON DELETE body is treated as success
      return { ok: true };
    }
  }

  private connectWs(port: number): void {
    this.clearWsReconnectTimer();
    const prev = this.ws;
    this.ws = null;
    prev?.close();
    this.wsPort = port;
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        maxPayload: RETICULUM_WS_MAX_MESSAGE_BYTES,
      });
      socket.on('open', () => {
        this.wsReconnectAttempt = 0;
      });
      socket.on('message', (data: Buffer) => {
        if (data.length > RETICULUM_WS_MAX_MESSAGE_BYTES) {
          console.warn(
            `[ReticulumSidecar] ws message exceeded ${RETICULUM_WS_MAX_MESSAGE_BYTES} byte cap, dropping`,
          );
          return;
        }
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
      socket.on('close', () => {
        if (this.wsPort === port) {
          this.ws = null;
          this.scheduleWsReconnect();
        }
      });
      this.ws = {
        close: () => {
          try {
            socket.removeAllListeners();
            // ws abortHandshake emits 'error' on nextTick when closed while CONNECTING
            socket.on('error', () => {
              // catch-no-log-ok: intentional teardown; CONNECTING abort is expected
            });
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
      this.scheduleWsReconnect();
    }
  }

  private clearWsReconnectTimer(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
  }

  /** Reconnect WS while the sidecar HTTP process is still running (event loss otherwise). */
  private scheduleWsReconnect(): void {
    this.clearWsReconnectTimer();
    if (!this._status.running || this.wsPort <= 0) return;
    const attempt = this.wsReconnectAttempt;
    this.wsReconnectAttempt = Math.min(attempt + 1, 8);
    const delayMs = Math.min(30_000, 500 * 2 ** attempt);
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      if (!this._status.running || this.wsPort <= 0) return;
      console.debug(
        `[ReticulumSidecar] ws reconnect attempt=${this.wsReconnectAttempt} port=${this.wsPort}`,
      );
      this.connectWs(this.wsPort);
    }, delayMs);
  }

  /** Tear down the WS bridge and cancel reconnect (used on sidecar stop). */
  private teardownWs(): void {
    this.clearWsReconnectTimer();
    this.wsPort = 0;
    this.wsReconnectAttempt = 0;
    const prev = this.ws;
    this.ws = null;
    prev?.close();
  }
}
