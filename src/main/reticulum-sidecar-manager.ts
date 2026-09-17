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
import { sanitizeLogMessage } from './log-service';
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
  resolveSidecarRustLog,
  ReticulumSidecarStderrDedupe,
  shouldForwardReticulumSidecarStdout,
} from './reticulumSidecarStderrLog';
import { startSidecarWatchdog } from './reticulumSidecarWatchdog';
import { ReticulumStackSessionTracker } from './reticulumStackSessionTracker';

const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_POLL_TIMEOUT_MS = 30 * MS_PER_SECOND;
/** Bound the pending-state flush (and, outside app quit, BLE detach) before SIGTERM. */
const PREPARE_STOP_TIMEOUT_MS = 1 * MS_PER_SECOND;
const STOP_GRACE_MS = 5 * MS_PER_SECOND;
/** App is exiting: skip the BLE detach drain and SIGKILL quickly so quit stays responsive. */
const QUIT_STOP_GRACE_MS = 750;

/** Minimal env for sidecar child processes (start + validate-config). */
export function sidecarChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR, // NOSONAR passthrough of existing env var only; no temp file write here
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    RUST_LOG: resolveSidecarRustLog(),
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
        if (body.status === 'ok') {
          return body;
        }
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
  private voiceWs: { close: () => void } | null = null;
  private wsPort = 0;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private voiceWsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectAttempt = 0;
  private voiceWsReconnectAttempt = 0;
  /** True after the first successful WS open for this sidecar process (reconnects set reconnect=true). */
  private wsEverConnected = false;
  private startPromise: Promise<ReticulumSidecarStatus> | null = null;
  private bleOnly = false;
  private startLiveAbort: AbortController | null = null;
  /** In-flight stop — start must await so a fresh spawn does not race SIGTERM exit. */
  private stopPromise: Promise<void> | null = null;
  /**
   * Set by stop() so an in-flight startOnce exits at the next checkpoint instead of
   * spawning after cargo/BLE yield. Lets Cancel/Disconnect return without waiting on cargo.
   */
  private startAbortRequested = false;
  /**
   * Bumped on stop so late completions cannot revive an aborted start.
   */
  private startAttemptGeneration = 0;
  /** Latched by stop({ forQuit: true }) so an in-flight graceful stop escalates to quit speed. */
  private quitFastRequested = false;
  /** Aborts an in-flight prepare-stop fetch when quit escalates a graceful stop. */
  private stopPrepareAbort: AbortController | null = null;
  /** Shortens the SIGTERM grace of an in-flight stop when quit escalates it. */
  private escalateStopKill: (() => void) | null = null;
  private readonly stderrDedupe = new ReticulumSidecarStderrDedupe();
  private readonly autoBeaconTracker = new ReticulumSidecarAutoBeaconTracker();
  private readonly interfaceIssueTracker = new ReticulumSidecarInterfaceIssueTracker();
  private readonly stackSessionTracker = new ReticulumStackSessionTracker(
    path.join(app.getPath('userData'), 'reticulum', 'stack-sessions.json'),
  );
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
      ...(this.bleOnly ? { running: false, processRunning: this._status.running } : {}),
      autoBeaconAlert: this.autoBeaconTracker.getAlert(),
      interfaceIssueAlert: this.interfaceIssueTracker.getAlert(),
      stackFastFlapSuspected: this.stackSessionTracker.isFastFlapSuspected(),
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
    this.stackSessionTracker.recordStop();
    this.clearSidecarTrackers();
    this.bleOnly = false;
    this._status = { running: false, port: 0, pid: null, healthy: true, unhealthySince: undefined };
    this.emit('status', this.getStatus());
  }

  private reticulumUserDir(...segments: string[]): string {
    return path.join(app.getPath('userData'), 'reticulum', ...segments);
  }

  async start(opts: ReticulumSidecarStartOptions = {}): Promise<ReticulumSidecarStatus> {
    return this.startProcess(opts, false);
  }

  private async startProcess(
    opts: ReticulumSidecarStartOptions,
    bleOnly: boolean,
  ): Promise<ReticulumSidecarStatus> {
    // After Cancel/stop aborts an in-flight start, do not rejoin that doomed promise —
    // wait for it to clear, then start fresh.
    if (this.startPromise && this.startAbortRequested) {
      try {
        await this.startPromise;
      } catch {
        // catch-no-log-ok: previous start aborted or failed; continue with a new start
      }
    }
    if (this.startPromise) {
      const generation = this.startAttemptGeneration;
      const status = await this.startPromise;
      if (!bleOnly && this.bleOnly) {
        this.throwIfStartAborted(generation);
        return this.startProcess({ reuseIfRunning: true }, false);
      }
      return status;
    }
    this.startAbortRequested = false;
    this.quitFastRequested = false;
    this.startPromise = this.startOnce(opts, bleOnly).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  /** Abort in-flight start at await checkpoints (cargo / pre-spawn). */
  private throwIfStartAborted(generation = this.startAttemptGeneration): void {
    if (!this.startAbortRequested && generation === this.startAttemptGeneration) return;
    throw new Error('RETICULUM_SIDECAR_START_ABORTED: stop requested during start');
  }

  private async startOnce(
    opts: ReticulumSidecarStartOptions = {},
    bleOnly = false,
  ): Promise<ReticulumSidecarStatus> {
    const generation = this.startAttemptGeneration;
    if (this.stopPromise) {
      await this.stopPromise;
    }
    this.throwIfStartAborted(generation);
    if ((opts.reuseIfRunning || bleOnly || this.bleOnly) && this._status.running && this.proc) {
      let healthy = false;
      try {
        await pollSidecarHealth(this._status.port);
        healthy = true;
      } catch {
        // catch-no-log-ok: reuseIfRunning health failed — stop stale process and start fresh
        await this.stopProc();
      }
      this.throwIfStartAborted(generation);
      if (healthy) {
        if (!bleOnly) {
          await this.startLiveStack(generation);
        }
        return this.getStatus();
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

    const port = await findFreePort();
    const binary = this.resolveBinaryPath();
    try {
      await ensureDevSidecarBinary(binary);
      this.throwIfStartAborted(generation);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }
    if (!fs.existsSync(binary)) {
      const msg = app.isPackaged
        ? `RETICULUM_SIDECAR_BUNDLED_MISSING: packaged sidecar binary not found at ${binary}`
        : `Reticulum sidecar binary not found: ${binary}. Run \`pnpm run reticulum:sidecar:build\` from the repo root (requires Rust).`;
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }

    this.throwIfStartAborted(generation);
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
    if (bleOnly) args.push('--ble-only');

    const proc = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: sidecarChildEnv(),
    });
    this.proc = proc;
    this.bleOnly = bleOnly;

    let stdoutBuffer = '';
    const processStdoutLine = (line: string): void => {
      const text = sanitizeLogMessage(line.trim());
      if (!text) return;
      this.recordSidecarOutputLine(text);
      if (!shouldForwardReticulumSidecarStdout(text)) return;
      // WARN/ERROR and PN-triage INFO must reach mesh-client.log (debug is filtered in packaged).
      console.warn('[ReticulumSidecar]', text);
    };
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) processStdoutLine(line);
    });
    proc.stdout?.on('end', () => {
      if (stdoutBuffer) processStdoutLine(stdoutBuffer);
      stdoutBuffer = '';
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
      // The watchdog no-ops once proc is null, but leaving it armed leaks its interval
      // across the next spawn.
      this.stopWatchdog();
      this.proc = null;
      this.bleOnly = false;
      this.stackSessionTracker.recordStop();
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
      const msg = err instanceof Error ? err.message : String(err);
      await this.stopProc();
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }

    // stop() kills the child during the health poll ("Process already spawned (e.g. health
    // poll): kill via stopProc"), so a health response landing just before the kill would
    // otherwise report a dead PID as running, connect a WS to a dead port, and arm a
    // watchdog for a process that is already gone.
    this.throwIfStartAborted(generation);
    if (this.proc !== proc) {
      throw new Error('RETICULUM_SIDECAR_START_ABORTED: process replaced during start');
    }

    this._status = {
      running: true,
      port,
      pid: proc.pid ?? null,
      healthy: true,
      unhealthySince: undefined,
    };
    if (!bleOnly) {
      this.stackSessionTracker.recordStart();
      this.connectWs(port);
    }
    this.startWatchdog();
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  /**
   * Ensure the sidecar process is running for LoRa BLE (Meshtastic/MeshCore GATT).
   * Does not require Reticulum UI Start — HTTP + GATT are ready after health.
   * Returns the localhost HTTP port.
   */
  async ensureForBle(): Promise<number> {
    const status = await this.startProcess({ reuseIfRunning: true }, true);
    if (!this._status.running || !this.proc || !status.port) {
      throw new Error(status.lastError ?? 'reticulum sidecar failed to start for BLE');
    }
    return status.port;
  }

  private async startLiveStack(generation: number): Promise<void> {
    const proc = this.proc;
    const port = this._status.port;
    const wasBleOnly = this.bleOnly;
    const abort = new AbortController();
    this.startLiveAbort = abort;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/stack/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(HEALTH_POLL_TIMEOUT_MS)]),
      });
      const text = await readResponseTextUpTo(res, RETICULUM_PROXY_MAX_RESPONSE_BYTES);
      const body = text ? (JSON.parse(text) as { ok?: boolean; error?: string }) : {};
      this.throwIfStartAborted(generation);
      if (this.proc !== proc) {
        throw new Error('RETICULUM_SIDECAR_START_ABORTED: process replaced during start');
      }
      if (!res.ok || body.ok !== true) {
        throw new Error(body.error || `Reticulum stack start failed: ${res.status}`);
      }
      this.bleOnly = false;
      this._status = { ...this._status, lastError: undefined };
      if (wasBleOnly) {
        this.stackSessionTracker.recordStart();
        this.connectWs(port);
      }
      this.emit('status', this.getStatus());
    } finally {
      if (this.startLiveAbort === abort) this.startLiveAbort = null;
    }
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
        // Use stop() so stopPromise stays set and concurrent start() awaits the guard.
        const bleOnly = this.bleOnly;
        await this.stop();
        await this.startProcess({}, bleOnly);
      },
    });
  }

  private stopWatchdog(): void {
    this.watchdogStop?.();
    this.watchdogStop = null;
  }

  /**
   * Stop the sidecar. `forQuit` only flushes pending state, skips the BLE detach drain,
   * and shortens the SIGTERM grace —
   * the app is exiting, so the OS reclaims the child and no other stack reuses the adapter.
   */
  async stop(opts: { forQuit?: boolean } = {}): Promise<void> {
    if (opts.forQuit) {
      this.quitFastRequested = true;
    }
    // Abort in-flight start at checkpoints (cargo) so Cancel does not wait on build.
    this.startAbortRequested = true;
    this.startAttemptGeneration += 1;
    this.startLiveAbort?.abort();
    if (this.startPromise && !this.proc) {
      // Pre-spawn: do not await cargo — startOnce throws at next checkpoint.
      void this.startPromise.catch(() => {
        // catch-no-log-ok: aborted/failed start; stop continues without blocking UI
      });
    } else if (this.startPromise) {
      // Process already spawned (e.g. health poll): kill via stopProc; do not wait on health.
      void this.startPromise.catch(() => {
        // catch-no-log-ok: start fails when proc is killed mid-health-poll
      });
    }
    if (this.stopPromise) {
      if (opts.forQuit) {
        // A graceful stop is already draining; do not let quit wait on it.
        this.stopPrepareAbort?.abort();
        this.escalateStopKill?.();
      }
      return this.stopPromise;
    }
    this.stopPromise = this.stopProc().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async stopProc(): Promise<void> {
    this.stopWatchdog();
    this.teardownWs();
    await this.prepareStopBestEffort();
    const proc = this.proc;
    this.proc = null;
    if (!proc) {
      this.finalizeStopped();
      return;
    }

    await new Promise<void>((resolve) => {
      const forceKill = (): void => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // catch-no-log-ok: process may already be gone during forced shutdown
        }
        resolve();
      };
      let killTimer = setTimeout(
        forceKill,
        this.quitFastRequested ? QUIT_STOP_GRACE_MS : STOP_GRACE_MS,
      );
      this.escalateStopKill = () => {
        clearTimeout(killTimer);
        killTimer = setTimeout(forceKill, QUIT_STOP_GRACE_MS);
      };

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

    this.escalateStopKill = null;
    this.finalizeStopped();
  }

  /** Flush pending discoveries before kill; normal Stop also asks BLE RNode to detach. */
  private async prepareStopBestEffort(): Promise<void> {
    const status = this.getStatus();
    if (!status.running || status.port <= 0 || !this.proc) {
      return;
    }
    const abort = new AbortController();
    this.stopPrepareAbort = abort;
    const timeoutTimer = setTimeout(() => {
      abort.abort();
    }, PREPARE_STOP_TIMEOUT_MS);
    const operation = this.quitFastRequested ? 'flush-state' : 'prepare-stop';
    try {
      const res = await fetch(`http://127.0.0.1:${status.port}/api/v1/stack/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: abort.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body: unknown = await res.json();
      if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) {
        throw new Error('Sidecar did not confirm state flush');
      }
    } catch (e: unknown) {
      console.debug(
        `[ReticulumSidecar] ${operation} failed — continuing with SIGTERM:`,
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    } finally {
      clearTimeout(timeoutTimer);
      this.stopPrepareAbort = null;
    }
  }

  async proxyGet(apiPath: string): Promise<unknown> {
    const status = this._status;
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath);
    const timeoutMs = reticulumProxyGetTimeoutMs(apiPath);
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      signal: AbortSignal.timeout(timeoutMs),
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
    const status = this._status;
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
    const status = this._status;
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
    const status = this._status;
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
    const status = this._status;
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
        const reconnect = this.wsEverConnected;
        this.wsEverConnected = true;
        this.wsReconnectAttempt = 0;
        // Notify renderer so inbound LXMF catch-up can run after lag/disconnect gaps.
        this.emit('event', {
          type: 'ws_connected',
          payload: { reconnect },
        });
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
          // voice.audio must arrive on /ws/voice → voiceAudio (not shared event bus).
          if (parsed.type === 'voice.audio') return;
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
    this.connectVoiceWs(port);
  }

  /** Dedicated high-rate PCM stream (`/ws/voice` → `voiceAudio` IPC). */
  private connectVoiceWs(port: number): void {
    this.clearVoiceWsReconnectTimer();
    const prev = this.voiceWs;
    this.voiceWs = null;
    prev?.close();
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/voice`, {
        maxPayload: RETICULUM_WS_MAX_MESSAGE_BYTES,
      });
      socket.on('open', () => {
        this.voiceWsReconnectAttempt = 0;
      });
      socket.on('message', (data: Buffer) => {
        if (data.length > RETICULUM_WS_MAX_MESSAGE_BYTES) {
          console.warn(
            `[ReticulumSidecar] voice ws message exceeded ${RETICULUM_WS_MAX_MESSAGE_BYTES} byte cap, dropping`,
          );
          return;
        }
        const text = data.toString('utf8');
        try {
          const parsed = JSON.parse(text) as { type?: string; payload?: unknown };
          if (parsed.type !== 'voice.audio') return;
          this.emit('voiceAudio', {
            type: 'voice.audio',
            payload: parsed.payload ?? parsed,
          });
        } catch {
          // catch-no-log-ok: ignore non-JSON on the voice audio socket
        }
      });
      socket.on('error', (err: Error) => {
        console.warn('[ReticulumSidecar] voice ws error:', sanitizeLogMessage(err.message));
      });
      socket.on('close', () => {
        if (this.wsPort === port) {
          this.voiceWs = null;
          this.scheduleVoiceWsReconnect();
        }
      });
      this.voiceWs = {
        close: () => {
          try {
            socket.removeAllListeners();
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
        '[ReticulumSidecar] voice ws bridge unavailable:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      this.scheduleVoiceWsReconnect();
    }
  }

  private clearWsReconnectTimer(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
  }

  private clearVoiceWsReconnectTimer(): void {
    if (this.voiceWsReconnectTimer) {
      clearTimeout(this.voiceWsReconnectTimer);
      this.voiceWsReconnectTimer = null;
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

  private scheduleVoiceWsReconnect(): void {
    this.clearVoiceWsReconnectTimer();
    if (!this._status.running || this.wsPort <= 0) return;
    const attempt = this.voiceWsReconnectAttempt;
    this.voiceWsReconnectAttempt = Math.min(attempt + 1, 8);
    const delayMs = Math.min(30_000, 500 * 2 ** attempt);
    this.voiceWsReconnectTimer = setTimeout(() => {
      this.voiceWsReconnectTimer = null;
      if (!this._status.running || this.wsPort <= 0) return;
      console.debug(
        `[ReticulumSidecar] voice ws reconnect attempt=${this.voiceWsReconnectAttempt} port=${this.wsPort}`,
      );
      this.connectVoiceWs(this.wsPort);
    }, delayMs);
  }

  /** Tear down the WS bridge and cancel reconnect (used on sidecar stop). */
  private teardownWs(): void {
    this.clearWsReconnectTimer();
    this.clearVoiceWsReconnectTimer();
    this.wsPort = 0;
    this.wsReconnectAttempt = 0;
    this.voiceWsReconnectAttempt = 0;
    this.wsEverConnected = false;
    const prev = this.ws;
    this.ws = null;
    prev?.close();
    const prevVoice = this.voiceWs;
    this.voiceWs = null;
    prevVoice?.close();
  }
}
