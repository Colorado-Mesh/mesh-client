import { type ChildProcess, spawn } from 'child_process';
import { randomBytes } from 'crypto';
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
  type ReticulumProxyPathOptions,
} from './reticulum-proxy-path';
import { ensureDevSidecarBinary, resolveSidecarBinaryPath } from './reticulum-sidecar-path';
import { ReticulumSidecarAutoBeaconTracker } from './reticulumSidecarAutoBeaconTracker';
import { ReticulumSidecarInterfaceIssueTracker } from './reticulumSidecarIssueTracker';
import {
  isReticulumSidecarAutoBeaconTxFailure,
  logReticulumSidecarStderrLine,
  normalizeReticulumSidecarOutputLine,
  resolveSidecarRustLog,
  reticulumSidecarLineSeverity,
  ReticulumSidecarStderrDedupe,
  ReticulumSidecarTcpReadErrorDedupe,
  shouldForwardReticulumSidecarStdout,
} from './reticulumSidecarStderrLog';
import { startSidecarWatchdog } from './reticulumSidecarWatchdog';
import { ReticulumStackSessionTracker } from './reticulumStackSessionTracker';

const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_POLL_TIMEOUT_MS = 30 * MS_PER_SECOND;
/** Bound normal Stop's state flush and BLE detach before SIGTERM. */
const PREPARE_STOP_TIMEOUT_MS = 1 * MS_PER_SECOND;
/** Large state files need more time to serialize and synchronize during Quit. */
const FLUSH_STATE_TIMEOUT_MS = 5 * MS_PER_SECOND;
const STOP_GRACE_MS = 5 * MS_PER_SECOND;
/** App is exiting: skip the BLE detach drain and SIGKILL quickly so quit stays responsive. */
const QUIT_STOP_GRACE_MS = 750;
const SIDECAR_AUTH_TOKEN_BYTES = 32;
const SIDECAR_CAPABILITY_ISSUER_TOKEN_BYTES = 32;
const SIDECAR_CAPABILITY_SESSION_ID_BYTES = 16;
const PATH_CAPABILITY_MINT_PATH = '/api/v1/internal/path-capabilities';

export type ReticulumPathCapabilityOperation =
  'rncp_send' | 'rncp_fetch' | 'rncp_listener' | 'nomad_content_source';

/** Generate the per-process bearer credential delivered through the child's private stdin. */
export function createReticulumSidecarAuthToken(): string {
  return randomBytes(SIDECAR_AUTH_TOKEN_BYTES).toString('base64url');
}

function createReticulumSidecarCapabilityIssuerToken(): string {
  return randomBytes(SIDECAR_CAPABILITY_ISSUER_TOKEN_BYTES).toString('base64url');
}

function createReticulumSidecarCapabilitySessionId(): string {
  return randomBytes(SIDECAR_CAPABILITY_SESSION_ID_BYTES).toString('base64url');
}

function sidecarAuthorizationHeaders(
  token: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  return { ...headers, Authorization: `Bearer ${token}` };
}

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

async function pollSidecarHealth(
  port: number,
  authToken: string,
): Promise<ReticulumStatusResponse> {
  const url = `http://127.0.0.1:${port}/api/v1/status`;
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  let lastError = 'health poll timeout';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        headers: sidecarAuthorizationHeaders(authToken),
        signal: AbortSignal.timeout(2_000),
      });
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
  private authToken: string | null = null;
  private capabilityIssuerToken: string | null = null;
  private capabilitySessionId: string | null = null;
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
  private readonly tcpReadErrorDedupe = new ReticulumSidecarTcpReadErrorDedupe((interfaceId) =>
    this.interfaceIssueTracker.interfaceNameForId(interfaceId),
  );
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

  /** Main-process-only credential handoff for the GATT proxy sharing this sidecar. */
  getAuthTokenForLocalProxy(): string {
    return this.requireAuthToken();
  }

  private requireAuthToken(): string {
    if (!this.authToken) {
      throw new Error('Reticulum sidecar authentication is unavailable');
    }
    return this.authToken;
  }

  private requireCapabilityIssuerToken(): string {
    if (!this.capabilityIssuerToken) {
      throw new Error('Reticulum sidecar picker capability issuer is unavailable');
    }
    return this.capabilityIssuerToken;
  }

  private requireCapabilitySessionId(): string {
    if (!this.capabilitySessionId) {
      throw new Error('Reticulum sidecar picker capability session is unavailable');
    }
    return this.capabilitySessionId;
  }

  private authHeaders(headers: Record<string, string> = {}): Record<string, string> {
    return sidecarAuthorizationHeaders(this.requireAuthToken(), headers);
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
    const beforeBond = new Set(this.interfaceIssueTracker.peekAlert()?.bleBondRemoved ?? []);
    this.mutateInterfaceIssues(
      () => {
        this.interfaceIssueTracker.recordLine(text);
      },
      { alwaysEmitAfterMs: 5_000 },
    );
    const afterBond = this.interfaceIssueTracker.peekAlert()?.bleBondRemoved ?? [];
    const newlyLatchedBond = afterBond.find((name) => !beforeBond.has(name));
    // Dispose LoRa CBCentralManager as soon as stderr latches Peer-removed —
    // do not wait for the renderer round-trip (bond-removed retries in ~3s).
    if (newlyLatchedBond) {
      void this.handleBleLtkDesyncLatch(newlyLatchedBond, text).catch((err: unknown) => {
        console.debug(
          '[ReticulumSidecar] LTK desync latch handler failed:',
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  }

  /**
   * Peer-removed / LTK desync: pause LoRa GATT, purge the OS bond when possible,
   * and let the sidecar emit `BleLtkDesync` for the renderer toast / re-pair UX.
   */
  private async handleBleLtkDesyncLatch(interfaceName: string, line: string): Promise<void> {
    try {
      const { gattSidecarProxy } = await import('./gatt-sidecar-proxy');
      await gattSidecarProxy.releaseBleCentral();
    } catch (err: unknown) {
      console.debug(
        '[ReticulumSidecar] releaseBleCentral on bond latch failed:',
        err instanceof Error ? err.message : String(err),
      );
    }

    let address = '';
    let deviceName = '';
    try {
      const listed = (await this.proxyGet('/api/v1/interfaces')) as {
        interfaces?: { name?: string; serial_port?: string | null }[];
      };
      for (const row of listed.interfaces ?? []) {
        if (row.name === interfaceName && row.serial_port) {
          address = row.serial_port;
          deviceName = row.name;
          break;
        }
      }
    } catch (err: unknown) {
      console.debug(
        '[ReticulumSidecar] LTK desync interface lookup failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
    if (!address) {
      console.debug('[ReticulumSidecar] LTK desync: no ble:// address for purge');
      return;
    }

    try {
      const result = (await this.proxyPost('/api/v1/ble/handle-ltk-desync', {
        address,
        ...(deviceName ? { name: deviceName } : {}),
        error: line,
      })) as {
        ok?: boolean;
        bond_purged?: boolean;
        message?: string;
        purge_error?: string | null;
      };
      console.debug(
        `[ReticulumSidecar] LTK desync handle ok=${String(result.ok)} purged=${String(result.bond_purged)} err=${result.purge_error ?? result.message ?? ''}`,
      );
      // blueutil --unpair is EXPERIMENTAL and often a no-op on modern macOS; open
      // System Settings → Bluetooth so the user can Forget when auto-purge fails.
      if (result.ok === true && result.bond_purged !== true) {
        try {
          const { openOsBluetoothSettings, isAllowedBluetoothSettingsUrl } =
            await import('./bluetoothSettings');
          const { shell } = await import('electron');
          await openOsBluetoothSettings({
            platform: process.platform,
            openExternal: async (url) => {
              if (!isAllowedBluetoothSettingsUrl(url)) {
                throw new Error('Blocked unexpected Bluetooth settings URL');
              }
              await shell.openExternal(url);
            },
          });
        } catch (openErr: unknown) {
          console.debug(
            '[ReticulumSidecar] open Bluetooth settings failed:',
            openErr instanceof Error ? openErr.message : String(openErr),
          );
        }
      }
    } catch (err: unknown) {
      console.debug(
        '[ReticulumSidecar] handle-ltk-desync failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
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

  /**
   * Clear BLE bond-removed / pairing-timeout banners after a named interface
   * reconnects successfully (renderer reports health online).
   */
  clearBleBondIssuesForOnlineInterfaces(
    onlineInterfaceNames: readonly string[],
  ): ReticulumSidecarStatus {
    return this.mutateInterfaceIssues(() => {
      this.interfaceIssueTracker.clearBleBondIssuesForOnlineInterfaces(
        new Set(onlineInterfaceNames),
      );
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
    this.authToken = null;
    this.capabilityIssuerToken = null;
    this.capabilitySessionId = null;
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
        await pollSidecarHealth(this._status.port, this.requireAuthToken());
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

    const authToken = createReticulumSidecarAuthToken();
    const capabilityIssuerToken = createReticulumSidecarCapabilityIssuerToken();
    const capabilitySessionId = createReticulumSidecarCapabilitySessionId();
    this.authToken = authToken;
    this.capabilityIssuerToken = capabilityIssuerToken;
    this.capabilitySessionId = capabilitySessionId;
    let proc: ChildProcess;
    try {
      proc = spawn(binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: sidecarChildEnv(),
      });
    } catch (error) {
      this.authToken = null;
      this.capabilityIssuerToken = null;
      this.capabilitySessionId = null;
      throw error;
    }
    if (!proc.stdin) {
      this.authToken = null;
      this.capabilityIssuerToken = null;
      this.capabilitySessionId = null;
      proc.kill('SIGKILL');
      throw new Error('Reticulum sidecar authentication pipe is unavailable');
    }
    proc.stdin.on('error', () => {
      // catch-no-log-ok: an early child exit may close stdin before end() flushes.
    });
    proc.stdin.end(
      `${JSON.stringify({ auth_token: authToken, capability_issuer_token: capabilityIssuerToken, capability_session_id: capabilitySessionId })}\n`,
    );
    this.proc = proc;
    this.bleOnly = bleOnly;
    this.tcpReadErrorDedupe.reset();

    // tracing-subscriber fmt() writes stderr (no with_writer). validate-config JSON
    // owns stdout, so both pipes share this line filter and the TCP read-error dedupe.
    const processOutputLine = (line: string): void => {
      const text = normalizeReticulumSidecarOutputLine(line);
      if (!text) return;
      this.recordSidecarOutputLine(text);
      if (isReticulumSidecarAutoBeaconTxFailure(text)) {
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
        return;
      }
      if (!shouldForwardReticulumSidecarStdout(text)) return;
      const decision = this.tcpReadErrorDedupe.decide(text);
      if (decision.level === 'debug') {
        console.debug('[ReticulumSidecar]', decision.message);
        return;
      }
      // WARN/ERROR and PN-triage INFO must reach mesh-client.log (debug is filtered in packaged).
      if (reticulumSidecarLineSeverity(text) === 'INFO') {
        console.info('[ReticulumSidecar]', decision.message);
        return;
      }
      console.warn('[ReticulumSidecar]', decision.message);
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
      console.debug(`[ReticulumSidecar] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.teardownWs();
      // The watchdog no-ops once proc is null, but leaving it armed leaks its interval
      // across the next spawn.
      this.stopWatchdog();
      this.proc = null;
      this.authToken = null;
      this.capabilityIssuerToken = null;
      this.capabilitySessionId = null;
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
      await pollSidecarHealth(port, authToken);
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
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
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
      getAuthorizationHeader: () => `Bearer ${this.requireAuthToken()}`,
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
    const startedForQuit = this.quitFastRequested;
    await this.prepareStopBestEffort();
    if (!startedForQuit && this.quitFastRequested) {
      // Quit may cancel prepare-stop before its save finishes. Give persistence
      // its own bounded request before terminating the process.
      // The sidecar holds its state lock through each write, even after HTTP abort.
      await this.prepareStopBestEffort();
    }
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
    const operation = this.quitFastRequested ? 'flush-state' : 'prepare-stop';
    const timeoutMs =
      operation === 'flush-state' ? FLUSH_STATE_TIMEOUT_MS : PREPARE_STOP_TIMEOUT_MS;
    const abort = new AbortController();
    // Repeated Quit requests may cancel the BLE drain, but not the bounded flush.
    if (operation === 'prepare-stop') this.stopPrepareAbort = abort;
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${status.port}/api/v1/stack/${operation}`, {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
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
        timedOut
          ? `Timed out after ${timeoutMs}ms`
          : sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    } finally {
      clearTimeout(timeoutTimer);
      if (this.stopPrepareAbort === abort) this.stopPrepareAbort = null;
    }
  }

  async proxyGet(apiPath: string, opts?: ReticulumProxyPathOptions): Promise<unknown> {
    const status = this._status;
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath, { ...opts, method: 'GET' });
    const timeoutMs = reticulumProxyGetTimeoutMs(apiPath);
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      headers: this.authHeaders(),
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

  async proxyPost(
    apiPath: string,
    body: unknown,
    opts?: ReticulumProxyPathOptions,
  ): Promise<unknown> {
    const status = this._status;
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath, opts);
    assertProxyBodySize(body);
    const pathOnly = normalized.split('?')[0] ?? normalized;
    // RRC connect includes path discovery + Link handshake + WELCOME wait.
    const postTimeoutMs = pathOnly === '/api/v1/rrc/connect' ? 60_000 : 30_000;
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(postTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`sidecar POST ${normalized} failed: ${res.status}`);
    }
    const text = await readResponseTextUpTo(res, RETICULUM_PROXY_MAX_RESPONSE_BYTES);
    return text ? (JSON.parse(text) as unknown) : {};
  }

  async proxyPostWithPathCapability(
    operation: ReticulumPathCapabilityOperation,
    apiPath: string,
    body: unknown,
  ): Promise<unknown> {
    return this.proxyWithPathCapability('POST', operation, apiPath, body);
  }

  async proxyPutWithPathCapability(
    operation: ReticulumPathCapabilityOperation,
    apiPath: string,
    body: unknown,
  ): Promise<unknown> {
    return this.proxyWithPathCapability('PUT', operation, apiPath, body);
  }

  private async proxyWithPathCapability(
    method: 'POST' | 'PUT',
    operation: ReticulumPathCapabilityOperation,
    apiPath: string,
    body: unknown,
  ): Promise<unknown> {
    const status = this._status;
    const proc = this.proc;
    if (!status.running || status.port <= 0 || !proc) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath, { allowDedicatedRoutes: true });
    assertProxyBodySize(body);
    const authToken = this.requireAuthToken();
    const capabilityIssuerToken = this.requireCapabilityIssuerToken();
    const capabilitySessionId = this.requireCapabilitySessionId();
    const payload = body ?? {};
    const mintRes = await fetch(`http://127.0.0.1:${status.port}${PATH_CAPABILITY_MINT_PATH}`, {
      method: 'POST',
      headers: sidecarAuthorizationHeaders(authToken, {
        'Content-Type': 'application/json',
        'x-mesh-capability-issuer': capabilityIssuerToken,
      }),
      body: JSON.stringify({ operation, body: payload }),
      signal: AbortSignal.timeout(30_000),
    });
    const mintText = await readResponseTextUpTo(mintRes, RETICULUM_PROXY_MAX_RESPONSE_BYTES);
    const mintBody = mintText
      ? (JSON.parse(mintText) as { ok?: boolean; capability?: unknown; error?: string })
      : {};
    if (!mintRes.ok || mintBody.ok !== true || typeof mintBody.capability !== 'string') {
      throw new Error(mintBody.error || `sidecar picker capability mint failed: ${mintRes.status}`);
    }
    if (
      this.proc !== proc ||
      this._status.port !== status.port ||
      this.authToken !== authToken ||
      this.capabilityIssuerToken !== capabilityIssuerToken ||
      this.capabilitySessionId !== capabilitySessionId
    ) {
      throw new Error('Reticulum sidecar picker capability session changed');
    }
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      method,
      headers: sidecarAuthorizationHeaders(authToken, {
        'Content-Type': 'application/json',
        'x-mesh-path-capability': mintBody.capability,
      }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`sidecar ${method} ${normalized} failed: ${res.status}`);
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
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`sidecar POST ${normalized} failed: ${res.status}`);
    }
    const text = await readResponseTextUpTo(res, RETICULUM_PROXY_MAX_RESPONSE_BYTES);
    return text ? (JSON.parse(text) as unknown) : {};
  }

  async proxyPut(
    apiPath: string,
    body: unknown,
    opts?: ReticulumProxyPathOptions,
  ): Promise<unknown> {
    const status = this._status;
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath, opts);
    assertProxyBodySize(body);
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`sidecar PUT ${normalized} failed: ${res.status}`);
    }
    const text = await readResponseTextUpTo(res, RETICULUM_PROXY_MAX_RESPONSE_BYTES);
    return text ? (JSON.parse(text) as unknown) : {};
  }

  async proxyDelete(apiPath: string, opts?: ReticulumProxyPathOptions): Promise<unknown> {
    const status = this._status;
    if (!status.running || status.port <= 0) {
      throw new Error('Reticulum sidecar is not running');
    }
    const normalized = assertReticulumProxyPath(apiPath, opts);
    const res = await fetch(`http://127.0.0.1:${status.port}${normalized}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
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
        headers: this.authHeaders(),
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
        headers: this.authHeaders(),
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
