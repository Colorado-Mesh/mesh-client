import { EventEmitter } from 'events';

import { withTimeout } from '../shared/withTimeout';
import { logDeviceConnection, sanitizeLogMessage } from './log-service';

// Only load noble on Mac/Windows — Linux uses Web Bluetooth in renderer instead
// eslint-disable-next-line @typescript-eslint/no-require-imports
const noble = process.platform === 'linux' ? null : require('@stoprocent/noble');

// Meshtastic BLE GATT UUIDs (from @meshtastic/transport-web-bluetooth)
const SERVICE_UUID = '6ba1b21815a8461f9fa85dcae273eafd';
const TORADIO_UUID = 'f75c76d2129e4dada1dd7866124401e7';
const FROMRADIO_UUID = '2c55e69e499311edb8780242ac120002';
const FROMNUM_UUID = 'ed9da18ca8004f66a670aa7547e34453';

// MeshCore BLE GATT UUIDs — Nordic UART Service (NUS)
// RX = we write to it (radio reads from it); TX = we read/notify from it (radio writes to it)
const MESHCORE_SERVICE_UUID = '6e400001b5a3f393e0a9e50e24dcca9e';
const MESHCORE_RX_UUID = '6e400002b5a3f393e0a9e50e24dcca9e';
const MESHCORE_TX_UUID = '6e400003b5a3f393e0a9e50e24dcca9e';

/** Max iterations per read-pump burst (avoids infinite spin on misbehaving stacks). */
const BLE_READ_PUMP_MAX_ITERATIONS = 512;
/** Timeout for a single fromRadio GATT read. */
const BLE_FROM_RADIO_READ_TIMEOUT_MS = 2000;
/** Delay before kicking read pump after a write (device prep time). */
const POST_WRITE_READ_PUMP_DELAY_MS = 100;

// BlueZ (Windows) BLE stack is significantly slower than macOS CBCentralManager.
// Use generous timeouts on Windows.
const IS_DARWIN = process.platform === 'darwin';
const IS_WIN32 = process.platform === 'win32';
/** Timeout for peripheral.connectAsync(). */
const BLE_CONNECT_TIMEOUT_MS = IS_DARWIN ? 15_000 : 30_000;
/** Timeout for GATT service/characteristic discovery. */
const BLE_DISCOVERY_TIMEOUT_MS = IS_DARWIN ? 15_000 : 30_000;
/** Timeout for characteristic subscribeAsync(). */
const BLE_SUBSCRIBE_TIMEOUT_MS = IS_DARWIN ? 10_000 : 20_000;

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase().replace(/-/g, '');
}

function normalizedGattProps(char: { properties?: unknown }): string[] {
  return Array.isArray(char.properties) ? char.properties : [];
}

/** Score NUS TX candidates so we pick a real char over WinRT stubs (duplicate UUIDs, empty props). */
function meshcoreNusTxScore(char: { properties?: unknown }): number {
  const p = normalizedGattProps(char);
  let s = p.length;
  if (p.includes('notify')) s += 100;
  if (p.includes('indicate')) s += 80;
  if (p.includes('read')) s += 40;
  return s;
}

function meshcoreNusRxScore(char: { properties?: unknown }): number {
  const p = normalizedGattProps(char);
  let s = p.length;
  if (p.some((x) => x === 'write' || x === 'writeWithoutResponse')) s += 100;
  return s;
}

function meshcorePickBestChar(candidates: any[], score: (c: any) => number): any {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (score(c) > score(best) ? c : best));
}

function formatBleDisconnectReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (reason == null) return 'none';
  if (typeof reason === 'string') return reason;
  if (typeof reason === 'number' || typeof reason === 'boolean') return String(reason);
  try {
    return JSON.stringify(reason);
  } catch {
    // catch-no-log-ok JSON.stringify failure for exotic disconnect reason values
    return '(unserializable)';
  }
}

export interface NobleBleDevice {
  deviceId: string;
  deviceName: string;
}

export type NobleSessionId = 'meshtastic' | 'meshcore';

interface NobleBleSession {
  // Noble GATT objects from @stoprocent/noble — typed as any (no stable TS surface); avoid `any | null` (redundant union).
  connectedPeripheral: any;
  connectedPeripheralDisconnectHandler: (() => void) | null;
  toRadioChar: any;
  fromRadioChar: any;
  fromNumChar: any;
  fromRadioDataHandler: ((data: Buffer, isNotification: boolean) => void) | null;
  fromNumDataHandler: ((data: Buffer) => void) | null;
  readPumpActive: boolean;
  readPumpRequested: boolean;
  /** Set to true on disconnect/close so the read pump exits without issuing more GATT reads. */
  closing: boolean;
  /** Cleared on disconnect; avoids post-write timer firing after teardown. */
  postWriteReadPumpTimer: ReturnType<typeof setTimeout> | null;
  /**
   * True when fromRadioChar delivers data via notifications and does not support GATT reads.
   * When set, the read pump and post-write read-pump timer are skipped entirely.
   * MeshCore NUS TX (6e400003) is notify-only; Meshtastic fromRadio supports reads.
   */
  fromRadioNotifyOnly: boolean;
  /** Count of fromRadio payloads forwarded to the renderer (notify + read pump). */
  fromRadioDeliveryCount: number;
  /** Total bytes in those payloads (for disconnect diagnostics). */
  fromRadioDeliveryBytes: number;
  /** True once first-packet diagnostics have been logged for this session. */
  firstPacketLogged: boolean;
  /** Unix ms when the current connect attempt started (for first-packet latency logs). */
  connectStartedAtMs: number | null;
  /** Tracks whether read-pump fallback actually delivered payloads this session. */
  fromRadioUsedReadPumpFallback: boolean;
  /** Linux MeshCore early-read polling attempt count before first payload. */
  meshcoreLinuxEarlyReadPollAttempts: number;
  /**
   * MeshCore only: set after link-up while GATT discovery/subscribe is still running.
   * A second `connect(samePeripheral)` awaits this instead of calling `disconnect()` first,
   * which would tear down the in-progress session (Win32 duplicate IPC / strict-mode).
   */
  meshcoreGattInflight: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (e: unknown) => void;
  } | null;
}

export class NobleBleManager extends EventEmitter {
  private readonly sessions = new Map<NobleSessionId, NobleBleSession>();
  /** Serializes connect() calls across all sessions to prevent native CBCentralManager races. */
  private connectQueue: Promise<void> = Promise.resolve();
  private readonly knownPeripherals = new Map<string, any>();
  /**
   * Tracks which sessions have an active scan interest.
   * meshtastic → filtered scan (Meshtastic service UUID only)
   * meshcore   → open scan (MeshCore service UUID is unknown)
   * Both       → open scan (superset)
   */
  private readonly scanRequesters = new Set<NobleSessionId>();
  private adapterReady = false;
  /** True only while noble.startScanning() has actually been called and confirmed active. */
  private scanningActive = false;
  private lastAdapterState = String(noble?.state ?? 'unknown');
  private releaseHandlesCallCount = 0;

  constructor() {
    super();
    if (process.platform === 'linux') {
      console.debug('[NobleBleManager] skipping init on Linux (using Web Bluetooth in renderer)');
      return;
    }
    this.sessions.set('meshtastic', this.createSessionState());
    this.sessions.set('meshcore', this.createSessionState());
    // Seed from the current synchronous state in case noble already transitioned before
    // this manager was constructed (avoids false "adapter not powered on" errors on startup).
    this.adapterReady = noble.state === 'poweredOn';
    noble.on('stateChange', (state: string) => {
      this.lastAdapterState = state;
      this.adapterReady = state === 'poweredOn';
      this.emit('adapterState', state);
      if (this.adapterReady && this.scanRequesters.size > 0) {
        void this.doStartScanning().catch((err: unknown) => {
          console.error('[NobleBleManager] deferred startScanning error:', err); // log-injection-ok noble internal error
        });
      }
    });

    noble.on('discover', (peripheral: any) => {
      // Client-side filter: noble's server-side UUID filter is unreliable on macOS.
      // When only the meshtastic session is scanning, only pass devices that advertise
      // the meshtastic service UUID. Devices that advertise zero service UUIDs are passed
      // through (older firmware omits UUIDs from advertisement data) with a debug log.
      if (!this.scanRequesters.has('meshcore') && this.scanRequesters.has('meshtastic')) {
        const advUuids: string[] = (peripheral.advertisement?.serviceUuids ?? []).map((u: string) =>
          u.toLowerCase().replace(/-/g, ''),
        );
        if (advUuids.length > 0 && !advUuids.includes(SERVICE_UUID)) {
          console.debug(
            `[NobleBleManager] discover: skipping non-meshtastic peripheral ${peripheral.id} (${peripheral.advertisement?.localName ?? 'unnamed'}) — advertised UUIDs: [${advUuids.join(', ')}]`,
          );
          return;
        }
        if (advUuids.length === 0) {
          console.debug(
            `[NobleBleManager] discover: passing peripheral ${peripheral.id} (${peripheral.advertisement?.localName ?? 'unnamed'}) with no advertised service UUIDs — may not be meshtastic`,
          );
        }
      }
      const id: string = peripheral.id;
      const name: string = peripheral.advertisement?.localName || peripheral.address || id;
      const isNew = !this.knownPeripherals.has(id);
      this.knownPeripherals.set(id, peripheral);
      if (isNew) {
        this.emit('deviceDiscovered', { deviceId: id, deviceName: name } as NobleBleDevice);
      }
    });
  }

  private createSessionState(): NobleBleSession {
    return {
      connectedPeripheral: null,
      connectedPeripheralDisconnectHandler: null,
      toRadioChar: null,
      fromRadioChar: null,
      fromNumChar: null,
      fromRadioDataHandler: null,
      fromNumDataHandler: null,
      readPumpActive: false,
      readPumpRequested: false,
      closing: false,
      postWriteReadPumpTimer: null,
      fromRadioNotifyOnly: false,
      fromRadioDeliveryCount: 0,
      fromRadioDeliveryBytes: 0,
      firstPacketLogged: false,
      connectStartedAtMs: null,
      fromRadioUsedReadPumpFallback: false,
      meshcoreLinuxEarlyReadPollAttempts: 0,
      meshcoreGattInflight: null,
    };
  }

  private getSession(sessionId: NobleSessionId): NobleBleSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown noble session: ${sessionId}`);
    return session;
  }

  private clearSessionState(session: NobleBleSession): void {
    if (session.meshcoreGattInflight) {
      try {
        session.meshcoreGattInflight.reject(new Error('BLE session cleared'));
      } catch {
        // catch-no-log-ok promise may already be settled
      }
      session.meshcoreGattInflight = null;
    }
    // Signal any in-flight read pump to exit without issuing more GATT reads.
    session.closing = true;
    if (session.postWriteReadPumpTimer !== null) {
      clearTimeout(session.postWriteReadPumpTimer);
      session.postWriteReadPumpTimer = null;
    }
    session.connectedPeripheral = null;
    session.connectedPeripheralDisconnectHandler = null;
    session.toRadioChar = null;
    session.fromRadioChar = null;
    session.fromNumChar = null;
    session.fromRadioDataHandler = null;
    session.fromNumDataHandler = null;
    session.readPumpActive = false;
    session.readPumpRequested = false;
    session.fromRadioNotifyOnly = false;
    session.fromRadioDeliveryCount = 0;
    session.fromRadioDeliveryBytes = 0;
    session.firstPacketLogged = false;
    session.connectStartedAtMs = null;
    session.fromRadioUsedReadPumpFallback = false;
    session.meshcoreLinuxEarlyReadPollAttempts = 0;
  }

  private emitFromRadio(
    sessionId: NobleSessionId,
    bytes: Uint8Array,
    source: 'notify' | 'read-pump',
  ): void {
    const session = this.getSession(sessionId);
    if (source === 'read-pump') {
      session.fromRadioUsedReadPumpFallback = true;
      session.meshcoreLinuxEarlyReadPollAttempts = 0;
    }
    session.fromRadioDeliveryCount += 1;
    session.fromRadioDeliveryBytes += bytes.length;
    if (!session.firstPacketLogged && sessionId === 'meshcore') {
      session.firstPacketLogged = true;
      const latencyMs =
        session.connectStartedAtMs == null ? null : Date.now() - session.connectStartedAtMs;
      const hexDump = Array.from(bytes.subarray(0, Math.min(bytes.length, 50)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      console.debug(
        `[BLE:meshcore] first fromRadio packet via ${source} after ${latencyMs ?? 'unknown'}ms (bytes=${bytes.length} data=[${hexDump}${bytes.length > 50 ? '...' : ''}] readPumpFallbackUsed=${session.fromRadioUsedReadPumpFallback} linuxEarlyPollAttempts=${session.meshcoreLinuxEarlyReadPollAttempts})`,
      );
    }
    this.emit('fromRadio', { sessionId, bytes });
  }

  /**
   * Whether to issue GATT reads on fromRadio (NUS TX / Meshtastic fromRadio) as a complement to notify.
   * - Fallback mode (subscribe failed): always read — notify is not active.
   * - Darwin: skip reads when notify is active — CoreBluetooth delivers notifications reliably.
   * - MeshCore + Win32 + notify active: skip reads — WinRT returns "Protocol error" on NUS TX read while
   *   notifications are enabled (logs: readPump-read-error). Rely on notify only.
   * - Linux + MeshCore: use read pump as fallback — BlueZ may not reliably deliver notifications
   *   for some devices, causing handshake hangs (device sends data but notify events never fire).
   * - Other non-Darwin: keep read pump alongside notify as a safety net when noble drops notifies.
   */
  private shouldUseFromRadioReadPump(sessionId: NobleSessionId, session: NobleBleSession): boolean {
    if (!session.fromRadioNotifyOnly) return true;
    if (IS_DARWIN) return false;
    if (IS_WIN32 && sessionId === 'meshcore') return false;
    return true;
  }

  private requestFromRadioReadPump(sessionId: NobleSessionId): void {
    const session = this.getSession(sessionId);
    if (session.closing) return;
    if (!this.shouldUseFromRadioReadPump(sessionId, session)) {
      return;
    }
    session.readPumpRequested = true;
    if (session.readPumpActive) return;
    session.readPumpActive = true;
    void this.runFromRadioReadPump(sessionId);
  }

  private async runFromRadioReadPump(sessionId: NobleSessionId): Promise<void> {
    const session = this.getSession(sessionId);
    try {
      while (session.readPumpRequested && !session.closing) {
        session.readPumpRequested = false;
        if (!session.fromRadioChar || !session.connectedPeripheral) return;
        for (let i = 0; i < BLE_READ_PUMP_MAX_ITERATIONS; i++) {
          /** MeshCore Win32 TX read-poll (no notify): first reads are often empty before any payload. */
          const meshcoreWinEarlyReadPoll =
            sessionId === 'meshcore' &&
            IS_WIN32 &&
            !session.fromRadioNotifyOnly &&
            session.fromRadioDeliveryCount === 0;
          // Exit immediately if session was torn down between reads.
          if (session.closing || session.connectedPeripheral?.state !== 'connected') {
            return;
          }
          if (!session.fromRadioChar) {
            return;
          }
          let data: Buffer;
          const t0 = Date.now();
          try {
            data = await withTimeout<Buffer>(
              session.fromRadioChar.readAsync(),
              BLE_FROM_RADIO_READ_TIMEOUT_MS,
              'BLE fromRadio read',
            );
          } catch (err) {
            console.warn(
              `[BLE:${sessionId}] readAsync #${i} error after ${Date.now() - t0}ms:`,
              sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
            );
            if (meshcoreWinEarlyReadPoll && !session.closing) {
              session.readPumpRequested = true;
            }
            // Back off before the outer while can re-trigger to avoid hammering a failing characteristic.
            await new Promise<void>((r) => setTimeout(r, 500));
            break;
          }
          if (!data || data.length === 0) {
            if (meshcoreWinEarlyReadPoll && i === 0 && !session.closing) {
              session.readPumpRequested = true;
              await new Promise<void>((r) => setTimeout(r, 150));
            }
            break;
          }
          this.emitFromRadio(sessionId, new Uint8Array(Buffer.from(data)), 'read-pump');
          // Small floor delay between consecutive reads to avoid flooding the CBQueue.
          await new Promise<void>((r) => setTimeout(r, 10));
        }
      }
    } finally {
      session.readPumpActive = false;
    }
  }

  /** True while a Noble scan is requested or a GATT session is active (used for app shutdown). */
  isBleSessionActive(): boolean {
    if (this.scanRequesters.size > 0) return true;
    for (const session of this.sessions.values()) {
      if (
        session.connectedPeripheral ||
        session.toRadioChar ||
        session.fromRadioChar ||
        session.fromNumChar
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns the scan filter for the current set of requesters.
   * - meshtastic only → filter by known Meshtastic service UUID (cleaner results)
   * - meshcore present → open scan (MeshCore service UUID is not publicly known)
   * - both → open scan (superset; discovers all BLE devices)
   */
  private computeScanFilter(): string[] {
    if (this.scanRequesters.has('meshcore')) {
      return [];
    }
    return [SERVICE_UUID];
  }

  async startScanning(sessionId: NobleSessionId): Promise<void> {
    // Clear known peripherals so every device is re-emitted as discovered on each new scan.
    // Without this, devices found in a previous scan are never re-emitted (isNew = false),
    // so the picker stays empty on second and subsequent scan attempts.
    // Preserve peripherals already connected in noble — they won't re-advertise during a
    // scan, so keep them available for connect() and re-emit for auto-connect / picker.
    const stillConnected: [string, any][] = [];
    for (const [id, peripheral] of this.knownPeripherals.entries()) {
      if (peripheral.state === 'connected') stillConnected.push([id, peripheral]);
    }
    this.knownPeripherals.clear();
    for (const [id, peripheral] of stillConnected) {
      this.knownPeripherals.set(id, peripheral);
      const name: string = peripheral.advertisement?.localName || peripheral.address || id;
      this.emit('deviceDiscovered', { deviceId: id, deviceName: name } as NobleBleDevice);
    }
    this.scanRequesters.add(sessionId);
    if (!this.adapterReady) {
      // On Linux/BlueZ, noble.state is asynchronously initialized ('unknown' at startup).
      // Wait up to 5s for the adapter to reach a definitive state before failing.
      console.debug(
        '[NobleBleManager] startScanning: adapter not ready, waiting for state change…',
      );
      await this.waitForAdapterReady(5000);
    }
    if (!this.adapterReady) {
      throw new Error('Bluetooth adapter is not powered on');
    }
    await this.doStartScanning();
  }

  async stopScanning(sessionId: NobleSessionId): Promise<void> {
    this.scanRequesters.delete(sessionId);
    if (this.scanRequesters.size === 0) {
      await this.doStopScanning();
    } else {
      // Other sessions still want to scan; restart with updated filter.
      // e.g. meshcore stopped → switch from open scan back to meshtastic-only filter.
      await this.doStartScanning();
    }
  }

  /** Stop all scanning immediately — used for app quit and force-quit IPC. */
  async stopAllScanning(): Promise<void> {
    this.scanRequesters.clear();
    await this.doStopScanning();
  }

  private doStartScanning(): Promise<void> {
    // Idempotent: if a scan is already active (e.g. kicked by stateChange handler concurrently),
    // skip the duplicate noble.startScanning() call.
    if (this.scanningActive) return Promise.resolve();
    const filter = this.computeScanFilter();
    return new Promise((resolve, reject) => {
      noble.startScanning(filter, false, (err: Error | null) => {
        if (err) {
          console.error('[NobleBleManager] startScanning error:', err); // log-injection-ok noble internal error
          reject(err);
          return;
        }
        this.scanningActive = true;
        resolve();
      });
    });
  }

  /**
   * Waits for the BLE adapter to reach a definitive state (poweredOn or any non-unknown state).
   * Resolves when the next adapterState event fires or when the timeout expires.
   * Always resolves (never rejects) so callers can re-check this.adapterReady themselves.
   *
   * On Linux/BlueZ, noble.state is 'unknown' at construction and transitions asynchronously
   * via D-Bus. This prevents false "adapter not powered on" errors during app startup.
   */
  private waitForAdapterReady(timeoutMs: number): Promise<void> {
    if (this.adapterReady) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const cleanup = () => {
        clearTimeout(timeout);
        this.off('adapterState', onState);
      };
      const onState = () => {
        if (this.adapterReady || Date.now() >= deadline) {
          cleanup();
          resolve();
        }
      };
      // Keep waiting through transient non-powered states (e.g. unknown/resetting) until
      // poweredOn arrives or timeout is reached.
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);
      this.on('adapterState', onState);
    });
  }

  private doStopScanning(): Promise<void> {
    if (!this.scanningActive) return Promise.resolve();
    // Mark stopped immediately — noble's stopScanning callback is unreliable on some platforms
    // (may never fire on Windows; can hang on macOS if CBCentralManager state is inconsistent).
    // CoreBluetooth receives the stop command regardless; we don't need to await confirmation.
    this.scanningActive = false;
    try {
      noble.stopScanning();
    } catch (err) {
      console.debug('[NobleBleManager] stopScanning error (ignored):', err); // log-injection-ok noble internal error
    }
    return Promise.resolve();
  }

  /**
   * Last-chance teardown for app exit. Must call noble._bindings.stop() to release the native
   * BLEManager (CFRelease), which frees the CBCentralManager and its CBqueue GCD dispatch queue.
   * Without this, the active GCD thread keeps the macOS process alive indefinitely.
   */
  releaseNobleProcessHandles(): void {
    this.releaseHandlesCallCount += 1; // Mark all sessions closing FIRST so any in-flight readAsync loop exits without issuing
    // more GATT reads. This prevents the CBCentralManager delegate firing into freed memory
    // after _bindings.stop() releases the native handle.
    for (const session of this.sessions.values()) {
      session.closing = true;
    }
    // Clear scan requesters to prevent any deferred scan restart during teardown.
    this.scanRequesters.clear();
    if (process.platform === 'linux') {
      return;
    }
    // Only call noble.stopScanning() if scanning is actually active.
    // Calling it twice in a row (e.g. once in before-quit and again here)
    // is a known SIGSEGV trigger in noble's native XPC layer.
    if (this.scanningActive) {
      this.scanningActive = false;
      try {
        noble.stopScanning();
      } catch (err) {
        console.debug(
          '[NobleBleManager] releaseNobleProcessHandles stopScanning error (ignored):',
          err,
        ); // log-injection-ok noble internal error
      }
    }
    try {
      noble.removeAllListeners('stateChange');
      noble.removeAllListeners('discover');
    } catch (err) {
      console.debug(
        '[NobleBleManager] releaseNobleProcessHandles removeAllListeners error (ignored):',
        err,
      ); // log-injection-ok noble internal error
    }
    this.removeAllListeners(); // Release the native BLEManager and its CBqueue dispatch queue (macOS only).
    // noble.stop() → _bindings.stop() → CFRelease(BLEManager) → CBCentralManager + dispatch queue released.
    try {
      noble.stop();
    } catch (err) {
      console.debug(
        '[NobleBleManager] releaseNobleProcessHandles noble.stop error (ignored):',
        err,
      ); // log-injection-ok noble internal error
    }
  }

  async connect(sessionId: NobleSessionId, peripheralId: string): Promise<void> {
    // Serialize across all sessions — noble's native CBCentralManager crashes (SIGSEGV/SIGBUS)
    // if a second peripheral's discoverServices/subscribe races with the first.
    const prevQueue = this.connectQueue;
    let releaseQueue!: () => void;
    this.connectQueue = new Promise<void>((r) => {
      releaseQueue = r;
    });
    await prevQueue;

    const session = this.getSession(sessionId);
    let peripheral: any = null;
    let connected = false;
    console.debug(
      `[BLE:${sessionId}] connect start — peripheralId=${peripheralId} adapterReady=${this.adapterReady} scanRequesters=[${[...this.scanRequesters].join(',')}]`,
    );
    try {
      if (!this.adapterReady) {
        throw new Error('Bluetooth adapter is not powered on');
      }
      // CBCentralManager on macOS cannot scan and connect simultaneously.
      // Stop scanning without clearing scanRequesters — it will resume in the finally block.
      // On Windows (WinRT) this restriction does not apply.
      if (process.platform === 'darwin' && this.scanningActive) {
        await this.doStopScanning();
      }
      const knownForMeshcore = this.knownPeripherals.get(peripheralId);
      if (
        sessionId === 'meshcore' &&
        knownForMeshcore &&
        session.connectedPeripheral?.id === knownForMeshcore.id &&
        session.toRadioChar &&
        session.fromRadioChar &&
        !session.closing
      ) {
        console.debug(
          `[BLE:meshcore] connect idempotent skip — already connected to ${peripheralId} (duplicate IPC would disconnect and break handshake)`,
        );
        return;
      }
      if (
        sessionId === 'meshcore' &&
        peripheralId === knownForMeshcore?.id &&
        session.connectedPeripheral?.id === knownForMeshcore.id &&
        session.meshcoreGattInflight &&
        !session.closing
      ) {
        console.debug(
          `[BLE:meshcore] connect coalesce — awaiting in-flight GATT setup for ${peripheralId} (avoid disconnect during discovery)`,
        );
        try {
          await session.meshcoreGattInflight.promise;
        } catch (err) {
          console.debug(
            `[BLE:meshcore] connect coalesce await failed — ${sanitizeLogMessage(err instanceof Error ? err.message : String(err))}`,
          );
          // First attempt failed or session cleared; fall through to full reconnect.
        }
        if (
          session.toRadioChar &&
          session.fromRadioChar &&
          session.connectedPeripheral?.id === knownForMeshcore.id &&
          !session.closing
        ) {
          console.debug(`[BLE:meshcore] connect coalesce done — session ready for ${peripheralId}`);
          return;
        }
      }
      await this.disconnect(sessionId);
      // Re-open a fresh session (disconnect sets closing=true; reset it for the new connection).
      session.closing = false;

      peripheral = this.knownPeripherals.get(peripheralId);
      if (!peripheral) {
        throw new Error(
          `BLE peripheral not found: ${peripheralId}. Scan for devices before connecting.`,
        );
      }
      console.debug(
        `[BLE:${sessionId}] peripheral info — address=${peripheral.address ?? 'unknown'} addressType=${peripheral.addressType ?? 'unknown'} rssi=${peripheral.rssi ?? 'unknown'} state=${peripheral.state} platform=${process.platform}`,
      );
      session.connectStartedAtMs = Date.now();
      session.firstPacketLogged = false;
      session.fromRadioUsedReadPumpFallback = false;
      session.meshcoreLinuxEarlyReadPollAttempts = 0;

      if (peripheral.state === 'connected') {
        let releasedOtherSession = false;
        for (const [otherSessionId, otherSession] of this.sessions.entries()) {
          if (
            otherSessionId !== sessionId &&
            otherSession.connectedPeripheral?.id === peripheral.id
          ) {
            console.debug(
              `[BLE:${sessionId}] peripheral ${peripheral.id} owned by ${otherSessionId} — disconnecting other session so this session can connect`,
            );
            await this.disconnect(otherSessionId);
            releasedOtherSession = true;
            break;
          }
        }
        // Peripheral is connected in noble's internal state but not claimed by any session
        // (e.g. leftover from a previous crashed session). Disconnect before reconnecting.
        // NOTE: register onDisconnected AFTER this cleanup so the pre-connect disconnectAsync()
        // does not prematurely trigger the handler and wipe the new session state.
        if (peripheral.state === 'connected' && !releasedOtherSession) {
          console.warn(
            `[BLE:${sessionId}] peripheral already connected in noble — disconnecting before reconnect`,
          );
          try {
            await withTimeout(
              peripheral.disconnectAsync(),
              5000,
              'BLE pre-connect disconnectAsync',
            );
          } catch (err) {
            console.debug(
              `[BLE:${sessionId}] pre-connect disconnect error (ignored):`,
              sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
            );
          }
        }
      }

      const onDisconnected = (reason?: unknown) => {
        const reasonStr = formatBleDisconnectReason(reason);
        console.debug(
          `[BLE:${sessionId}] peripheral disconnected — reason=${sanitizeLogMessage(reasonStr)}`,
        );
        if (sessionId === 'meshcore' && session.fromRadioDeliveryCount === 0) {
          console.warn(
            `[BLE:meshcore] session ended with no fromRadio data (platform=${process.platform} notify subscribed but 0 packets; check signal/link or stack). disconnectReason=${sanitizeLogMessage(reasonStr)} linuxEarlyPollAttempts=${session.meshcoreLinuxEarlyReadPollAttempts} readPumpFallbackUsed=${session.fromRadioUsedReadPumpFallback} note=debugfs conn_* permission-denied lines can come from noble internals and do not always mean cap_net_raw is missing.`,
          );
        } else if (sessionId === 'meshcore') {
          console.debug(
            `[BLE:meshcore] session fromRadio summary packets=${session.fromRadioDeliveryCount} bytes=${session.fromRadioDeliveryBytes} readPumpFallbackUsed=${session.fromRadioUsedReadPumpFallback} disconnectReason=${sanitizeLogMessage(reasonStr)}`,
          );
        }
        if (session.fromRadioChar && session.fromRadioDataHandler) {
          try {
            session.fromRadioChar.off('data', session.fromRadioDataHandler);
          } catch {
            // catch-no-log-ok BLE char listener cleanup on disconnect — already disconnected
          }
        }
        if (session.fromNumChar && session.fromNumDataHandler) {
          try {
            session.fromNumChar.off('data', session.fromNumDataHandler);
          } catch {
            // catch-no-log-ok BLE char listener cleanup on disconnect — already disconnected
          }
        }
        this.clearSessionState(session);
        this.emit('disconnected', { sessionId });
      };
      peripheral.once('disconnect', onDisconnected);
      session.connectedPeripheralDisconnectHandler = onDisconnected;
      // Log MTU negotiation — WinRT sometimes negotiates asynchronously after connect.
      peripheral.once('mtu', (mtu: number) => {
        console.debug(`[BLE:${sessionId}] MTU updated: ${mtu}`);
      });

      // Stop scanning before connecting — many Linux/BlueZ drivers abort connections while scanning.
      if (this.scanningActive) {
        console.debug(`[BLE:${sessionId}] stopping scan before connect`);
        await new Promise<void>((resolve) => {
          const onScanStop = () => {
            noble.removeListener('scanStop', onScanStop);
            resolve();
          };
          noble.on('scanStop', onScanStop);
          void this.doStopScanning();
        });
      }

      const tConnect = Date.now();
      try {
        await withTimeout(peripheral.connectAsync(), BLE_CONNECT_TIMEOUT_MS, 'BLE connectAsync');
      } catch (err) {
        if (err instanceof Error && /BLE connectAsync timed out/i.test(err.message)) {
          const hint =
            process.platform === 'linux'
              ? ' On Linux/BlueZ: reset the adapter (bluetoothctl power off; power on) and ensure the device is not connected to another host.'
              : process.platform === 'win32'
                ? ' On Windows: try pairing the device in Windows Bluetooth settings first, then retry.'
                : '';
          throw new Error(err.message + hint);
        }
        throw err;
      }
      connected = true;
      console.debug(
        `[BLE:${sessionId}] connectAsync done in ${Date.now() - tConnect}ms — address=${peripheral.address ?? 'unknown'} mtu=${peripheral.mtu ?? 'null'} state=${peripheral.state}`,
      );
      // Set early so idempotent duplicate IPC + disconnect handlers see the peripheral during long GATT setup.
      session.connectedPeripheral = peripheral;

      const isMeshcore = sessionId === 'meshcore';
      if (isMeshcore) {
        let resolveGatt!: () => void;
        let rejectGatt!: (e: unknown) => void;
        const promise = new Promise<void>((resolve, reject) => {
          resolveGatt = resolve;
          rejectGatt = reject;
        });
        // Avoid unhandledRejection when no duplicate connect is awaiting coalesce.
        void promise.catch(() => {});
        session.meshcoreGattInflight = {
          promise,
          resolve: resolveGatt,
          reject: rejectGatt,
        };
      }
      const discoverServiceUuids = isMeshcore ? [MESHCORE_SERVICE_UUID] : [SERVICE_UUID];
      const discoverCharUuids = isMeshcore
        ? [MESHCORE_RX_UUID, MESHCORE_TX_UUID]
        : [TORADIO_UUID, FROMRADIO_UUID, FROMNUM_UUID];

      const tDiscover = Date.now();
      const meshcoreWinFullDiscovery = isMeshcore && IS_WIN32;
      let characteristics: any[];
      if (meshcoreWinFullDiscovery) {
        const all = await withTimeout<{ characteristics: any[] }>(
          peripheral.discoverAllServicesAndCharacteristicsAsync(),
          BLE_DISCOVERY_TIMEOUT_MS,
          'BLE full GATT discovery (meshcore Win32)',
        );
        characteristics = all.characteristics;
      } else {
        const discovered = await withTimeout<{ characteristics: any[] }>(
          peripheral.discoverSomeServicesAndCharacteristicsAsync(
            discoverServiceUuids,
            discoverCharUuids,
          ),
          BLE_DISCOVERY_TIMEOUT_MS,
          'BLE characteristic discovery',
        );
        characteristics = discovered.characteristics;
      }
      if (isMeshcore) {
        const rxCandidates: any[] = [];
        const txCandidates: any[] = [];
        for (const char of characteristics) {
          const uuid = normalizeUuid(char.uuid);
          if (uuid === MESHCORE_RX_UUID) rxCandidates.push(char);
          else if (uuid === MESHCORE_TX_UUID) txCandidates.push(char);
        }
        console.debug(
          `[BLE:${sessionId}] meshcore candidates: rxCandidates=${rxCandidates.length} (${rxCandidates.map((c) => `${normalizeUuid(c.uuid)}[${(c.properties ?? []).join(',')}]`).join(', ')}), txCandidates=${txCandidates.length} (${txCandidates.map((c) => `${normalizeUuid(c.uuid)}[${(c.properties ?? []).join(',')}]`).join(', ')})`,
        );
        const viableRx = rxCandidates.filter((c) => meshcoreNusRxScore(c) > 0);
        const viableTx = txCandidates.filter((c) => meshcoreNusTxScore(c) > 0);
        session.toRadioChar = meshcorePickBestChar(
          viableRx.length > 0 ? viableRx : rxCandidates,
          meshcoreNusRxScore,
        );
        session.fromRadioChar = meshcorePickBestChar(
          viableTx.length > 0 ? viableTx : txCandidates,
          meshcoreNusTxScore,
        );
        if (session.fromRadioChar) {
          const selectedProps = session.fromRadioChar.properties ?? [];
          console.debug(
            `[BLE:${sessionId}] selected fromRadioChar: uuid=${normalizeUuid(session.fromRadioChar.uuid)} props=[${selectedProps.join(',')}] viableTx=${viableTx.length}`,
          );
        }
      } else {
        for (const char of characteristics) {
          const uuid = normalizeUuid(char.uuid);
          if (uuid === TORADIO_UUID) session.toRadioChar = char;
          else if (uuid === FROMRADIO_UUID) session.fromRadioChar = char;
          else if (uuid === FROMNUM_UUID) session.fromNumChar = char;
        }
      }
      console.debug(
        `[BLE:${sessionId}] discovered chars in ${Date.now() - tDiscover}ms — toRadio=${Boolean(session.toRadioChar)} fromRadio=${Boolean(session.fromRadioChar)} fromNum=${Boolean(session.fromNumChar)} toRadioProps=${JSON.stringify(session.toRadioChar?.properties)} fromRadioProps=${JSON.stringify(session.fromRadioChar?.properties)} fromNumProps=${JSON.stringify(session.fromNumChar?.properties)}`,
      );
      if (isMeshcore) {
        console.debug(
          `[BLE:${sessionId}] ALL discovered characteristics for meshcore: ${characteristics
            .map((c: any) => `${normalizeUuid(c.uuid)}[${(c.properties ?? []).join(',')}]`)
            .join(', ')}`,
        );
      }

      // FROMNUM is optional for notification-based flow; require only TX/RX characteristics.
      if (!session.toRadioChar || !session.fromRadioChar) {
        console.warn(
          `[BLE:${sessionId}] missing required chars — toRadio=${Boolean(session.toRadioChar)} fromRadio=${Boolean(session.fromRadioChar)} discoveredUuids=${characteristics.map((c: any) => c.uuid).join(',')}`, // log-injection-ok noble internal characteristic UUIDs
        );
        throw new Error('Failed to find required BLE characteristics');
      }

      if (session.fromNumChar) {
        session.fromNumDataHandler = () => {
          this.requestFromRadioReadPump(sessionId);
        };
        session.fromNumChar.on('data', session.fromNumDataHandler);
        await withTimeout(
          session.fromNumChar.subscribeAsync(),
          BLE_SUBSCRIBE_TIMEOUT_MS,
          'BLE fromNum subscribe',
        );
      }
      const fromRadioProps: string[] = Array.isArray(session.fromRadioChar.properties)
        ? session.fromRadioChar.properties
        : [];
      const fromRadioSupportsNotify =
        fromRadioProps.includes('notify') || fromRadioProps.includes('indicate');
      const fromRadioCanRead = fromRadioProps.includes('read');
      // Notify-first strategy:
      // - Register the `data` listener before subscribeAsync() so WinRT/noble cannot drop the first notify.
      // - On macOS, CoreBluetooth reliably delivers notify events — read-pump is skipped.
      // - On Windows/Linux, noble may not deliver notify events even after a successful subscribe,
      //   so the read-pump runs in parallel as a safety net (except meshcore+Win32: read errors — see above).
      // - Fall back to read-pump only if subscribe fails or notify is unavailable.
      session.fromRadioNotifyOnly = false;
      const tSubscribe = Date.now();
      let fromRadioSubscribed = false;
      if (fromRadioSupportsNotify) {
        try {
          const fromRadioNotifyStateHandler = (state: boolean) => {
            console.debug(
              `[BLE:${sessionId}] fromRadio notify state=${state} platform=${process.platform} timeSinceConnect=${session.connectStartedAtMs != null ? Date.now() - session.connectStartedAtMs : 'unknown'}ms`,
            );
          };
          session.fromRadioChar.on?.('notify', fromRadioNotifyStateHandler);
          session.fromRadioDataHandler = (data: Buffer) => {
            const byteLen = data?.length ?? 0;
            if (byteLen === 0) {
              return;
            }
            this.emitFromRadio(sessionId, new Uint8Array(Buffer.from(data)), 'notify');
          };
          session.fromRadioChar.on('data', session.fromRadioDataHandler);
          await withTimeout(
            session.fromRadioChar.subscribeAsync(),
            BLE_SUBSCRIBE_TIMEOUT_MS,
            'BLE fromRadio subscribe',
          );
          fromRadioSubscribed = true;
          session.fromRadioNotifyOnly = true;
          const notifyProps = session.fromRadioChar.properties ?? [];
          console.debug(
            `[BLE:${sessionId}] fromRadio subscribe succeeded hasNotify=${fromRadioSupportsNotify} canRead=${fromRadioCanRead} platform=${process.platform} readPumpEnabled=${this.shouldUseFromRadioReadPump(sessionId, session)} fromRadioProps=[${notifyProps.join(',')}]`,
          );
          console.debug(
            `[BLE:${sessionId}] fromRadio strategy=notify-first (hasNotify=${fromRadioSupportsNotify} canRead=${fromRadioCanRead})`,
          );
        } catch (err) {
          console.warn(
            `[BLE:${sessionId}] fromRadio subscribe failed; falling back to read-pump (hasNotify=${fromRadioSupportsNotify} canRead=${fromRadioCanRead}):`,
            sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
          );
        }
      }
      if (!fromRadioSubscribed) {
        if (!fromRadioCanRead) {
          throw new Error('fromRadio characteristic supports neither notify nor read');
        }
        console.debug(
          `[BLE:${sessionId}] fromRadio strategy=fallback-read (hasNotify=${fromRadioSupportsNotify} canRead=${fromRadioCanRead})`,
        );
      }
      console.debug(
        `[BLE:${sessionId}] subscriptions ready in ${Date.now() - tSubscribe}ms — fromNum=${Boolean(session.fromNumChar)} fromRadioNotify=${fromRadioSubscribed} fromRadioReadPump=${!fromRadioSubscribed && fromRadioCanRead} mtu=${peripheral.mtu ?? 'null'}`,
      );

      // One-shot initial read in case the device already queued bytes before the first FROMNUM notify.
      this.requestFromRadioReadPump(sessionId);

      if (session.meshcoreGattInflight) {
        session.meshcoreGattInflight.resolve();
        session.meshcoreGattInflight = null;
      }
      logDeviceConnection(
        `transport=ble stack=${sessionId} peripheralId=${sanitizeLogMessage(peripheralId)} mac=${sanitizeLogMessage(String(peripheral.address ?? 'unknown'))}`,
      );
      this.emit('connected', { sessionId });
    } catch (err) {
      console.warn(`[BLE:${sessionId}] connect failed:`, err instanceof Error ? err.message : err); // log-injection-ok noble internal error
      if (session.meshcoreGattInflight) {
        try {
          session.meshcoreGattInflight.reject(err instanceof Error ? err : new Error(String(err)));
        } catch {
          // catch-no-log-ok promise may already be settled
        }
        session.meshcoreGattInflight = null;
      }
      if (session.fromRadioChar && session.fromRadioDataHandler) {
        try {
          session.fromRadioChar.off('data', session.fromRadioDataHandler);
        } catch {
          // catch-no-log-ok BLE char listener cleanup in connect error path — error already logged
        }
      }
      if (session.fromNumChar && session.fromNumDataHandler) {
        try {
          session.fromNumChar.off('data', session.fromNumDataHandler);
        } catch {
          // catch-no-log-ok BLE char listener cleanup in connect error path — error already logged
        }
      }
      if (peripheral && session.connectedPeripheralDisconnectHandler) {
        try {
          peripheral.removeListener('disconnect', session.connectedPeripheralDisconnectHandler);
        } catch {
          // catch-no-log-ok peripheral listener cleanup in connect error path — error already logged
        }
      }
      this.clearSessionState(session);
      if (connected) {
        await peripheral.disconnectAsync().catch(() => {});
      }
      throw err;
    } finally {
      releaseQueue();
      // If any session was scanning when we stopped for this connect, restart the scan now.
      if (this.scanRequesters.size > 0 && this.adapterReady && !this.scanningActive) {
        void this.doStartScanning().catch((err: unknown) => {
          console.error('[NobleBleManager] post-connect scan restart error:', err); // log-injection-ok noble internal error
        });
      }
    }
  }

  isConnected(sessionId: NobleSessionId): boolean {
    const session = this.sessions.get(sessionId);
    return session?.toRadioChar != null;
  }

  async writeToRadio(sessionId: NobleSessionId, data: Buffer): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session.toRadioChar)
      throw new Error(`Not connected to a BLE device for session ${sessionId}`);
    await session.toRadioChar.writeAsync(data, false);
    const scheduleReadPump = this.shouldUseFromRadioReadPump(sessionId, session);
    if (scheduleReadPump) {
      if (session.postWriteReadPumpTimer !== null) {
        clearTimeout(session.postWriteReadPumpTimer);
        session.postWriteReadPumpTimer = null;
      }
      session.postWriteReadPumpTimer = setTimeout(() => {
        session.postWriteReadPumpTimer = null;
        this.requestFromRadioReadPump(sessionId);
      }, POST_WRITE_READ_PUMP_DELAY_MS);
    }
  }

  async disconnect(sessionId: NobleSessionId): Promise<void> {
    const session = this.getSession(sessionId);
    const peripheral = session.connectedPeripheral;
    const fromRadio = session.fromRadioChar;
    const fromNum = session.fromNumChar;
    const onPeripheralDisconnect = session.connectedPeripheralDisconnectHandler;
    const onFromRadioData = session.fromRadioDataHandler;
    const onFromNumData = session.fromNumDataHandler;

    if (!peripheral && !session.toRadioChar && !fromRadio && !fromNum) return;
    this.clearSessionState(session);

    try {
      if (fromNum) {
        try {
          if (onFromNumData) fromNum.removeListener?.('data', onFromNumData);
          else fromNum.removeAllListeners?.('data');
          await fromNum.unsubscribeAsync();
        } catch (err) {
          console.debug('[NobleBleManager] fromNum unsubscribe error (ignored):', err); // log-injection-ok noble internal error
        }
      }
      if (fromRadio) {
        try {
          if (onFromRadioData) fromRadio.removeListener?.('data', onFromRadioData);
          else fromRadio.removeAllListeners?.('data');
          // If fromRadio was subscribed via GATT notifications, unsubscribe it cleanly.
          if (onFromRadioData) {
            await fromRadio.unsubscribeAsync?.();
          }
        } catch (err) {
          console.debug('[NobleBleManager] fromRadio cleanup error (ignored):', err); // log-injection-ok noble internal error
        }
      }
      if (peripheral && onPeripheralDisconnect) {
        try {
          peripheral.removeListener?.('disconnect', onPeripheralDisconnect);
        } catch (err) {
          console.debug('[NobleBleManager] peripheral cleanup error (ignored):', err); // log-injection-ok noble internal error
        }
      }
      if (peripheral) {
        try {
          await withTimeout(peripheral.disconnectAsync(), 5000, 'BLE disconnectAsync');
        } catch (err) {
          console.debug('[NobleBleManager] disconnectAsync error (ignored):', err); // log-injection-ok noble internal error
        }
      }
    } finally {
      this.emit('disconnected', { sessionId });
    }
  }

  async disconnectAll(): Promise<void> {
    // On Linux, Noble is not initialized (Web Bluetooth is used in renderer instead)
    if (this.sessions.size === 0) {
      console.debug('[NobleBleManager] disconnectAll: skipping (not initialized on Linux)');
      return;
    }
    await Promise.all(
      (['meshtastic', 'meshcore'] as NobleSessionId[]).map((sessionId) =>
        this.disconnect(sessionId),
      ),
    );
  }
}
