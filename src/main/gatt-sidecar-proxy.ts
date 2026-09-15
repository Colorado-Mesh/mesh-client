/**
 * Main-process proxy: Electron IPC ↔ reticulum-sidecar GATT HTTP/WS.
 * Replaces NobleBleManager as the LoRa BLE transport owner.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';

import {
  sanitizeForConsoleEcho,
  sanitizeForLogSink,
  sanitizeLogMessage,
} from './sanitize-log-message';

export type GattSessionProfile = 'meshtastic' | 'meshcore';

export interface GattDiscoveredDevice {
  deviceId: string;
  deviceName: string;
  rssi?: number | null;
  address?: string | null;
}

export type GattConnectResult = { ok: true } | { ok: false; error: string; code?: string };

export type GattStartScanResult =
  | { ok: true }
  | { ok: false; code: 'scan_busy'; owner: string }
  | { ok: false; code: string; error: string };

interface LiveSession {
  port: number;
  reservationId: symbol;
  sidecarSessionId: string;
  profile: GattSessionProfile;
  address: string;
  ws: WebSocket | null;
  rssiPoll: ReturnType<typeof setInterval> | null;
}

interface ConnectionReservation {
  profile: GattSessionProfile;
  address: string;
  port: number;
  sidecarSessionId: string | null;
  cleaningUp: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

/** Match Connection panel host-link meter poll cadence. */
const GATT_RSSI_POLL_MS = 4_000;
/** Default HTTP budget — disconnect/quit must not hang behind a long connect/scan. */
const GATT_HTTP_TIMEOUT_MS = 3_000;
/** Connect / scan may include an unfiltered discovery sleep (~8s) plus GATT open. */
const GATT_HTTP_LONG_TIMEOUT_MS = 45_000;
/** Hard ceiling for quit-time disconnectAll. */
const GATT_DISCONNECT_ALL_BUDGET_MS = 2_000;

function profileFromSession(sessionId: string): GattSessionProfile {
  if (sessionId === 'meshcore') return 'meshcore';
  return 'meshtastic';
}

function unknownMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Error && value.message) return value.message;
  return fallback;
}

function wsDataToUtf8(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

export class GattSidecarProxy extends EventEmitter {
  private port = 0;
  private sidecarGeneration = 0;
  private readonly sessions = new Map<GattSessionProfile, LiveSession>();
  private readonly connectAttempts = new Map<GattSessionProfile, symbol>();
  private readonly reservations = new Map<symbol, ConnectionReservation>();
  private ensureFn: (() => Promise<number>) | null = null;
  private connectionGuard: ((sessionId: GattSessionProfile, address: string) => void) | null = null;

  /** Wire ensure callback (starts sidecar for BLE-light, returns HTTP port). */
  setEnsureSidecar(fn: () => Promise<number>): void {
    this.ensureFn = fn;
  }

  setConnectionGuard(guard: (sessionId: GattSessionProfile, address: string) => void): void {
    this.connectionGuard = guard;
  }

  getConnections(): { mac: string; owner: `gatt:${GattSessionProfile}` }[] {
    return [...this.reservations.values()].map(({ profile, address }) => ({
      mac: address,
      owner: `gatt:${profile}`,
    }));
  }

  private async ensurePort(): Promise<number> {
    if (this.port > 0) return this.port;
    if (!this.ensureFn) {
      throw new Error('gatt sidecar ensure not configured');
    }
    const generation = this.sidecarGeneration;
    const port = await this.ensureFn();
    if (generation !== this.sidecarGeneration) {
      if (this.port === port) this.port = 0;
      throw new Error('gatt sidecar exited during startup');
    }
    this.port = port;
    return port;
  }

  /** Called when sidecar reports a new port after restart. */
  setPort(port: number): void {
    this.port = port;
  }

  /**
   * Sidecar process died — drop cached port and local sessions so the next GATT
   * op re-runs ensureForBle() instead of fetch-failing against a dead port.
   */
  invalidateAfterSidecarExit(): void {
    this.port = 0;
    this.sidecarGeneration += 1;
    this.connectAttempts.clear();
    for (const id of this.reservations.keys()) this.releaseReservation(id);
    const ids = [...this.sessions.keys()];
    for (const sessionId of ids) {
      this.clearLocalSession(sessionId);
      this.emit('disconnected', { sessionId });
    }
  }

  private baseUrl(port: number): string {
    return `http://127.0.0.1:${port}`;
  }

  private async jsonFetch(
    path: string,
    init?: RequestInit,
    opts?: { timeoutMs?: number; port?: number },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const port = opts?.port ?? (await this.ensurePort());
    const headers = new Headers(init?.headers);
    headers.set('content-type', 'application/json');
    const timeoutMs = opts?.timeoutMs ?? GATT_HTTP_TIMEOUT_MS;
    const res = await fetch(`${this.baseUrl(port)}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await res.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // catch-no-log-ok: empty or non-JSON body
    }
    return { status: res.status, body };
  }

  private emitIssue(code: string, message: string, sessionId?: GattSessionProfile): void {
    // Sidecar WS/HTTP `code`/`message` are untrusted; use CodeQL-recognized barriers.
    const safeCode = sanitizeForLogSink(code);
    const safeMessage = sanitizeForLogSink(message);
    console.error(
      sanitizeForConsoleEcho(`[GATT:${sessionId ?? 'all'}] ${safeCode}: ${safeMessage}`),
    ); // log-filter-ok session-scoped: LogPanel matches [GATT:meshtastic]/[GATT:all]/[GATT:meshcore] explicitly
    this.emit('issue', { sessionId, code: safeCode, message: safeMessage });
  }

  async startScan(sessionId: GattSessionProfile): Promise<GattStartScanResult> {
    const mode = profileFromSession(sessionId);
    const { status, body } = await this.jsonFetch(
      `/api/v1/gatt/scan?mode=${mode}&timeout_secs=8`,
      undefined,
      { timeoutMs: GATT_HTTP_LONG_TIMEOUT_MS },
    );
    if (status < 200 || status >= 300 || body.ok !== true) {
      const code = typeof body.code === 'string' ? body.code : 'internal';
      if (code === 'scan_busy') {
        return {
          ok: false,
          code: 'scan_busy',
          owner: typeof body.owner === 'string' ? body.owner : 'unknown',
        };
      }
      const error = unknownMessage(body.error, 'scan failed');
      this.emitIssue(code, error, sessionId);
      return { ok: false, code, error };
    }
    const devices = Array.isArray(body.devices) ? body.devices : [];
    for (const raw of devices) {
      if (!raw || typeof raw !== 'object') continue;
      const d = raw as Record<string, unknown>;
      const address = typeof d.address === 'string' ? d.address : '';
      if (!address) continue;
      const device: GattDiscoveredDevice = {
        deviceId: address,
        deviceName: typeof d.name === 'string' && d.name ? d.name : address,
        rssi: typeof d.rssi === 'number' ? d.rssi : null,
        address,
      };
      this.emit('deviceDiscovered', device);
    }
    // Do not synthesize adapterState here — every reconnect scan was resetting MeshCore's
    // BLE reconnect budget (poweredOn → handleConnectionLost) into an infinite retry loop.
    return { ok: true };
  }

  stopScan(sessionId: GattSessionProfile): Promise<void> {
    // Sidecar scan is request-scoped; keep the profile arg for IPC parity / future cancel.
    if (sessionId !== 'meshtastic' && sessionId !== 'meshcore') {
      return Promise.reject(new Error(`gatt stopScan: invalid session ${sessionId}`));
    }
    return Promise.resolve();
  }

  async connect(sessionId: GattSessionProfile, peripheralId: string): Promise<GattConnectResult> {
    this.connectionGuard?.(sessionId, peripheralId);
    void this.disconnect(sessionId);
    const attempt = Symbol();
    this.connectAttempts.set(sessionId, attempt);
    const reservation: ConnectionReservation = {
      profile: sessionId,
      address: peripheralId,
      port: 0,
      sidecarSessionId: null,
      cleaningUp: false,
      cleanupTimer: null,
    };
    this.reservations.set(attempt, reservation);
    const isCurrent = () => this.connectAttempts.get(sessionId) === attempt;
    const cancelled: GattConnectResult = {
      ok: false,
      error: 'BLE connect cancelled',
      code: 'connect_aborted',
    };
    const profile = profileFromSession(sessionId);
    try {
      const port = await this.ensurePort();
      if (!isCurrent()) return cancelled;
      reservation.port = port;
      const { status, body } = await this.jsonFetch(
        '/api/v1/gatt/sessions',
        {
          method: 'POST',
          body: JSON.stringify({ profile, address: peripheralId }),
        },
        { timeoutMs: GATT_HTTP_LONG_TIMEOUT_MS, port },
      );
      if (typeof body.sessionId === 'string') reservation.sidecarSessionId = body.sessionId;
      if (!isCurrent()) {
        this.beginRemoteCleanup(attempt);
        return cancelled;
      }
      if (status < 200 || status >= 300 || body.ok !== true || typeof body.sessionId !== 'string') {
        this.beginRemoteCleanup(attempt);
        const code = typeof body.code === 'string' ? body.code : 'connect_timeout';
        const error = unknownMessage(body.error, 'connect failed');
        this.emitIssue(code, error, sessionId);
        this.emit('connect-aborted', { sessionId, message: error });
        return { ok: false, error, code };
      }
      const sidecarSessionId = body.sessionId;
      const { ws, ready } = this.openSessionWs(port, sidecarSessionId, sessionId);
      this.sessions.set(sessionId, {
        port,
        reservationId: attempt,
        sidecarSessionId,
        profile,
        address: peripheralId,
        ws,
        rssiPoll: null,
      });
      await ready;
      if (!isCurrent() || this.sessions.get(sessionId)?.ws !== ws) return cancelled;
      this.startRssiPoll(sessionId);
      this.emit('connected', { sessionId });
      return { ok: true };
    } catch (e) {
      // catch-no-log-ok: reported via connect-aborted; canceled attempts stay quiet.
      // A cancelled attempt must not send errors into its replacement's reconnect loop.
      if (!isCurrent()) return cancelled;
      this.clearLocalSession(sessionId);
      this.beginRemoteCleanup(attempt);
      const error = unknownMessage(e, 'connect failed');
      this.emit('connect-aborted', { sessionId, message: error });
      return { ok: false, error, code: 'connect_timeout' };
    } finally {
      if (isCurrent()) {
        this.connectAttempts.delete(sessionId);
      }
      if (!reservation.sidecarSessionId) this.releaseReservation(attempt);
    }
  }

  private startRssiPoll(sessionId: GattSessionProfile): void {
    const live = this.sessions.get(sessionId);
    if (!live || live.rssiPoll) return;
    const tick = () => {
      void this.getRssi(sessionId).then((rssi) => {
        if (rssi == null || this.sessions.get(sessionId) !== live) return;
        this.emit('linkRssi', { sessionId, rssi });
      });
    };
    tick();
    live.rssiPoll = setInterval(tick, GATT_RSSI_POLL_MS);
  }

  private stopRssiPoll(sessionId: GattSessionProfile): void {
    const live = this.sessions.get(sessionId);
    if (!live?.rssiPoll) return;
    clearInterval(live.rssiPoll);
    live.rssiPoll = null;
  }

  private openSessionWs(
    port: number,
    sidecarSessionId: string,
    sessionId: GattSessionProfile,
  ): { ws: WebSocket; ready: Promise<void> } {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/v1/gatt/sessions/${sidecarSessionId}/events`,
      { handshakeTimeout: GATT_HTTP_TIMEOUT_MS },
    );
    const isCurrent = () => this.sessions.get(sessionId)?.ws === ws;
    const disconnected = () => {
      if (!isCurrent()) return;
      const reservationId = this.sessions.get(sessionId)!.reservationId;
      this.clearLocalSession(sessionId);
      this.beginRemoteCleanup(reservationId);
      this.emit('disconnected', { sessionId });
    };
    // Keep an error listener after the handshake: an unhandled ws error reaches
    // Electron's app-wide crash handler, including close() while still connecting.
    ws.on('error', (error) => {
      if (!isCurrent()) return;
      this.emitIssue('internal', error.message, sessionId);
      disconnected();
    });
    const ready = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        ws.off('open', opened);
        ws.off('error', failed);
        ws.off('close', closed);
      };
      const opened = () => {
        cleanup();
        resolve();
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const closed = () => {
        failed(new Error('GATT event socket closed before opening'));
      };
      ws.once('open', opened);
      ws.once('error', failed);
      ws.once('close', closed);
    });
    ws.on('message', (data) => {
      if (!isCurrent()) return;
      try {
        const text = wsDataToUtf8(data);
        const ev = JSON.parse(text) as {
          type?: string;
          payload?: Record<string, unknown>;
          data_b64?: string;
          reason?: string;
          code?: string;
          message?: string;
          rssi?: number;
          mtu?: number;
        };
        // Events may be tagged { type, payload } or flat GattSessionEvent serde.
        const type = ev.type;
        const payload = (ev.payload ?? ev) as Record<string, unknown>;
        if (type === 'bytes' || payload.data_b64) {
          const b64 = unknownMessage(payload.data_b64, '');
          const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
          this.emit('fromRadio', { sessionId, bytes });
        } else if (type === 'disconnected') {
          disconnected();
        } else if (type === 'rssi' && typeof payload.rssi === 'number') {
          this.emit('linkRssi', { sessionId, rssi: payload.rssi });
        } else if (type === 'error') {
          const code = unknownMessage(payload.code, 'internal');
          const message = unknownMessage(payload.message, 'gatt error');
          this.emitIssue(code, message, sessionId);
        }
      } catch (e) {
        console.warn(
          '[GATT] ws parse failed:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    });
    ws.on('close', disconnected);
    return { ws, ready };
  }

  private clearLocalSession(sessionId: GattSessionProfile): void {
    this.stopRssiPoll(sessionId);
    const live = this.sessions.get(sessionId);
    if (!live) return;
    this.sessions.delete(sessionId);
    try {
      if (live.ws?.readyState === WebSocket.CONNECTING) live.ws.terminate();
      else live.ws?.close();
    } catch {
      // catch-no-log-ok
    }
  }

  disconnect(sessionId: GattSessionProfile): Promise<void> {
    this.connectAttempts.delete(sessionId);
    const live = this.sessions.get(sessionId);
    if (!live) return Promise.resolve();
    // Drop local session first so UI Disconnect / quit are not blocked on sidecar BLE teardown.
    this.clearLocalSession(sessionId);
    this.emit('disconnected', { sessionId });
    this.beginRemoteCleanup(live.reservationId);
    return Promise.resolve();
  }

  private releaseReservation(id: symbol): void {
    const reservation = this.reservations.get(id);
    if (reservation?.cleanupTimer) clearTimeout(reservation.cleanupTimer);
    this.reservations.delete(id);
  }

  private beginRemoteCleanup(id: symbol): void {
    const reservation = this.reservations.get(id);
    if (!reservation?.sidecarSessionId || reservation.cleaningUp) return;
    reservation.cleaningUp = true;
    void this.reconcileRemoteSession(id);
  }

  private async reconcileRemoteSession(id: symbol): Promise<void> {
    const reservation = this.reservations.get(id);
    if (!reservation?.sidecarSessionId) return;
    const { port, sidecarSessionId } = reservation;
    // Pin teardown to the process that created the session; cleanup must not start
    // a new sidecar or send an old session id to a replacement process.
    try {
      const { status, body } = await this.jsonFetch(
        `/api/v1/gatt/sessions/${sidecarSessionId}`,
        { method: 'DELETE' },
        { timeoutMs: GATT_HTTP_TIMEOUT_MS, port },
      );
      if (
        (status >= 200 && status < 300 && body.ok === true) ||
        body.code === 'session_not_found'
      ) {
        this.releaseReservation(id);
        return;
      }
    } catch (e) {
      console.debug(
        '[GATT] disconnect request failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    }
    if (!this.reservations.has(id)) return;
    try {
      const { body } = await this.jsonFetch(
        `/api/v1/gatt/sessions/${sidecarSessionId}/connected`,
        undefined,
        { timeoutMs: GATT_HTTP_TIMEOUT_MS, port },
      );
      if (body.connected === false) {
        this.releaseReservation(id);
        return;
      }
    } catch (e) {
      console.debug(
        '[GATT] disconnect probe failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    }
    if (!this.reservations.has(id)) return;
    // Keep the MAC reserved until teardown is confirmed; another protocol must
    // not claim a peripheral whose OS connection is still being released.
    reservation.cleanupTimer = setTimeout(() => {
      reservation.cleanupTimer = null;
      void this.reconcileRemoteSession(id);
    }, GATT_RSSI_POLL_MS);
    reservation.cleanupTimer.unref();
  }

  async isConnected(sessionId: GattSessionProfile): Promise<boolean> {
    const live = this.sessions.get(sessionId);
    if (!live) return false;
    try {
      const { body } = await this.jsonFetch(
        `/api/v1/gatt/sessions/${live.sidecarSessionId}/connected`,
        undefined,
        { timeoutMs: GATT_HTTP_TIMEOUT_MS, port: live.port },
      );
      return this.sessions.get(sessionId) === live && body.connected === true;
    } catch {
      // catch-no-log-ok: treat probe failures as disconnected
      return false;
    }
  }

  async toRadio(sessionId: GattSessionProfile, bytes: Uint8Array): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) {
      throw new Error(`gatt session ${sessionId} not connected`);
    }
    const data_b64 = Buffer.from(bytes).toString('base64');
    const { status, body } = await this.jsonFetch(
      `/api/v1/gatt/sessions/${live.sidecarSessionId}/write`,
      {
        method: 'POST',
        body: JSON.stringify({ data_b64 }),
      },
      { timeoutMs: GATT_HTTP_TIMEOUT_MS, port: live.port },
    );
    if (status < 200 || status >= 300 || body.ok !== true) {
      const code = typeof body.code === 'string' ? body.code : 'write_failed';
      const error = unknownMessage(body.error, 'write failed');
      this.emitIssue(code, error, sessionId);
      throw new Error(error);
    }
  }

  async getRssi(sessionId: GattSessionProfile): Promise<number | null> {
    const live = this.sessions.get(sessionId);
    if (!live) return null;
    try {
      const { body } = await this.jsonFetch(
        `/api/v1/gatt/sessions/${live.sidecarSessionId}/rssi`,
        undefined,
        { timeoutMs: GATT_HTTP_TIMEOUT_MS, port: live.port },
      );
      return typeof body.rssi === 'number' ? body.rssi : null;
    } catch {
      // catch-no-log-ok: RSSI is best-effort; missing value is null
      return null;
    }
  }

  /** Disconnect all LoRa GATT sessions (app quit). */
  async disconnectAll(): Promise<void> {
    const ids = [...new Set([...this.connectAttempts.keys(), ...this.sessions.keys()])];
    if (ids.length === 0) return;
    await Promise.race([
      Promise.allSettled(ids.map((id) => this.disconnect(id))),
      new Promise<void>((resolve) => {
        setTimeout(resolve, GATT_DISCONNECT_ALL_BUDGET_MS);
      }),
    ]);
    // Ensure polls/WS are gone even if DELETE timed out in the race.
    for (const id of ids) {
      if (this.sessions.has(id)) {
        this.clearLocalSession(id);
        this.emit('disconnected', { sessionId: id });
      }
    }
  }
}

export const gattSidecarProxy = new GattSidecarProxy();
