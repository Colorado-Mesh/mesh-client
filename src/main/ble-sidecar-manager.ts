import { type ChildProcess, spawn } from 'child_process';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import net from 'net';
import path from 'path';

import { MS_PER_SECOND } from '../shared/timeConstants';
import { ensureDevSidecarBinary, resolveSidecarBinaryPath } from './ble-sidecar-path';
import { startSidecarWatchdog } from './ble-sidecar-watchdog';
import { sanitizeLogMessage } from './log-service';

const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_POLL_TIMEOUT_MS = 30 * MS_PER_SECOND;
const STOP_GRACE_MS = 5 * MS_PER_SECOND;
/** App is exiting: SIGKILL quickly so quit stays responsive. */
const QUIT_STOP_GRACE_MS = 750;
/** Default RUST_LOG: warnings plus GATT triage INFO. */
const SIDECAR_DEFAULT_RUST_LOG = 'warn,mesh_hub_ble::gatt=info';

/** Process status of the Bluetooth (GATT) helper. */
export interface BleSidecarStatus {
  running: boolean;
  port: number;
  pid: number | null;
  healthy?: boolean;
  unhealthySince?: number;
  lastError?: string;
}

/**
 * Resolve RUST_LOG for the sidecar. Honors MESH_HUB_RUST_LOG, then RUST_LOG,
 * else defaults to warn so INFO spam does not fill the app log.
 */
export function resolveSidecarRustLog(env: NodeJS.ProcessEnv = process.env): string {
  const fromApp = env.MESH_HUB_RUST_LOG?.trim();
  if (fromApp) return fromApp;
  const fromRust = env.RUST_LOG?.trim();
  if (fromRust) return fromRust;
  return SIDECAR_DEFAULT_RUST_LOG;
}

/** Minimal env for the sidecar child process. */
export function sidecarChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR, // NOSONAR passthrough of existing env var only; no temp file write here
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    RUST_LOG: resolveSidecarRustLog(),
    // tracing-subscriber fmt() writes stderr. Keep level/target tokens uncolored.
    NO_COLOR: '1',
  };
  if (process.platform === 'win32') {
    env.APPDATA = process.env.APPDATA;
    env.USERPROFILE = process.env.USERPROFILE;
    env.LOCALAPPDATA = process.env.LOCALAPPDATA;
  }
  return env;
}

/** Tracing severity token (`WARN`, `ERROR`, `INFO`, …) of one sidecar output line. */
export function sidecarLineSeverity(text: string): string {
  const match = /\b(TRACE|DEBUG|INFO|WARN|ERROR)\b/.exec(text);
  return match?.[1] ?? '';
}

async function findFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function pollSidecarHealth(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/api/v1/status`;
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  let lastError = 'health poll timeout';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (!res.ok) {
        lastError = `status ${res.status}`;
      } else {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'ok') return;
        lastError = `unexpected status field: ${body.status ?? 'missing'}`;
      }
    } catch (err) {
      // catch-no-log-ok: health poll retries until deadline; lastError surfaces on timeout
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(lastError);
}

/**
 * Owns the native Bluetooth helper process (`mesh-hub-ble`, btleplug) that carries
 * Meshtastic and MeshCore GATT sessions. Emits `status` ({@link BleSidecarStatus}) on
 * every process state change so the GATT proxy can track the HTTP port.
 */
export class BleSidecarManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private startPromise: Promise<BleSidecarStatus> | null = null;
  private stopPromise: Promise<void> | null = null;
  private quitFastRequested = false;
  private watchdogStop: (() => void) | null = null;
  private _status: BleSidecarStatus = { running: false, port: 0, pid: null, healthy: true };

  getStatus(): BleSidecarStatus {
    return { ...this._status };
  }

  /**
   * Ensure the helper is running for LoRa BLE (Meshtastic/MeshCore GATT).
   * Returns the localhost HTTP port.
   */
  async ensureForBle(): Promise<number> {
    if (this.stopPromise) await this.stopPromise;
    if (this.proc && this._status.running) return this._status.port;
    this.startPromise ??= this.startOnce().finally(() => {
      this.startPromise = null;
    });
    const status = await this.startPromise;
    if (!status.running || !status.port) {
      throw new Error(status.lastError ?? 'Bluetooth helper failed to start');
    }
    return status.port;
  }

  private async startOnce(): Promise<BleSidecarStatus> {
    this.quitFastRequested = false;
    const storageDir = path.join(app.getPath('userData'), 'ble-sidecar');
    fs.mkdirSync(storageDir, { recursive: true });

    const binary = resolveSidecarBinaryPath();
    try {
      await ensureDevSidecarBinary(binary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }
    if (!fs.existsSync(binary)) {
      const msg = app.isPackaged
        ? `BLE_SIDECAR_BUNDLED_MISSING: packaged Bluetooth helper not found at ${binary}`
        : `Bluetooth helper binary not found: ${binary}. Run \`pnpm run ble:sidecar:build\` from the repo root (requires Rust).`;
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }

    const port = await findFreePort();
    const args = ['--headless', '--host', '127.0.0.1', '--port', String(port)];
    args.push('--storage-dir', storageDir);
    const proc = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env: sidecarChildEnv() });
    this.proc = proc;

    const processOutputLine = (line: string): void => {
      const text = line.trim();
      if (!text) return;
      const severity = sidecarLineSeverity(text);
      const message = sanitizeLogMessage(text);
      if (severity === 'WARN' || severity === 'ERROR') {
        console.warn('[BleSidecar]', message);
      } else if (severity === 'INFO') {
        console.info('[BleSidecar]', message);
      } else {
        console.debug('[BleSidecar]', message);
      }
    };
    const bindOutputLines = (stream: typeof proc.stdout): void => {
      if (!stream) return;
      let buffer = '';
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) processOutputLine(line);
      });
      stream.on('end', () => {
        if (buffer) processOutputLine(buffer);
        buffer = '';
      });
    };
    bindOutputLines(proc.stdout);
    bindOutputLines(proc.stderr);
    proc.on('exit', (code, signal) => {
      console.debug(`[BleSidecar] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      if (this.proc !== proc) return;
      this.stopWatchdog();
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
      await this.stopProc();
      this._status = { running: false, port: 0, pid: null, lastError: msg };
      throw new Error(msg);
    }
    if (this.proc !== proc) {
      throw new Error('BLE_SIDECAR_START_ABORTED: process replaced during start');
    }

    this._status = { running: true, port, pid: proc.pid ?? null, healthy: true };
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
        // Hung-only: process still alive but HTTP dead.
        await this.stop();
        await this.ensureForBle();
      },
    });
  }

  private stopWatchdog(): void {
    this.watchdogStop?.();
    this.watchdogStop = null;
  }

  /** Stop the helper. `forQuit` shortens the SIGTERM grace. */
  async stop(opts: { forQuit?: boolean } = {}): Promise<void> {
    if (opts.forQuit) this.quitFastRequested = true;
    this.stopPromise ??= this.stopProc().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async stopProc(): Promise<void> {
    this.stopWatchdog();
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(
          () => {
            try {
              proc.kill('SIGKILL');
            } catch {
              // catch-no-log-ok: process may already be gone during forced shutdown
            }
            resolve();
          },
          this.quitFastRequested ? QUIT_STOP_GRACE_MS : STOP_GRACE_MS,
        );
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
    }
    this._status = { running: false, port: 0, pid: null, healthy: true };
    this.emit('status', this.getStatus());
  }
}
