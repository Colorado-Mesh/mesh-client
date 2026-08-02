import { EventEmitter } from 'events';

import { attMtuOrDefault, maxWriteRequestPayloadBytes } from '../shared/bleAttWriteLimit';
import { withTimeout } from '../shared/withTimeout';
import { bleCoexistenceCoordinator, type BlePeripheralOwner } from './ble-coexistence-coordinator';
import { logDeviceConnection, sanitizeLogMessage } from './log-service';

interface NobleAdvertisement {
  localName?: string;
  serviceUuids?: string[];
}

interface NobleCharacteristic {
  uuid: string;
  properties?: string[];
  on(event: 'data', listener: (data: Buffer, isNotification: boolean) => void): this;
  on(event: 'notify', listener: (state: boolean) => void): this;
  off(event: 'data', listener: (data: Buffer, isNotification: boolean) => void): this;
  removeListener(event: 'data', listener: (data: Buffer, isNotification: boolean) => void): this;
  removeAllListeners(event?: 'data'): this;
  readAsync(): Promise<Buffer>;
  writeAsync(data: Buffer, withoutResponse: boolean): Promise<void>;
  subscribeAsync(): Promise<void>;
  unsubscribeAsync(): Promise<void>;
}

interface NobleDiscoveryResult {
  characteristics: NobleCharacteristic[];
}

interface NoblePeripheral {
  id: string;
  address?: string;
  addressType?: string;
  advertisement?: NobleAdvertisement;
  mtu?: number | null;
  rssi?: number;
  state: string;
  on(event: 'mtu', listener: (mtu: number) => void): this;
  once(event: 'disconnect', listener: (reason?: unknown) => void): this;
  removeListener(event: 'mtu', listener: (mtu: number) => void): this;
  removeListener(event: 'disconnect', listener: (reason?: unknown) => void): this;
  removeAllListeners(event?: 'mtu'): this;
  connectAsync(): Promise<void>;
  disconnectAsync(): Promise<void>;
  discoverAllServicesAndCharacteristicsAsync(): Promise<NobleDiscoveryResult>;
  discoverSomeServicesAndCharacteristicsAsync(
    serviceUuids: string[],
    characteristicUuids: string[],
  ): Promise<NobleDiscoveryResult>;
}

interface NobleApi {
  state: string;
  on(event: 'stateChange', listener: (state: string) => void): this;
  on(event: 'discover', listener: (peripheral: NoblePeripheral) => void): this;
  on(event: 'scanStop', listener: () => void): this;
  removeListener(event: 'scanStop', listener: () => void): this;
  removeAllListeners(event?: 'stateChange' | 'discover'): this;
  startScanning(
    serviceUuids: string[],
    allowDuplicates: boolean,
    callback: (error: Error | null) => void,
  ): void;
  stopScanning(): void;
  stop(): void;
}

// Only load noble on Mac/Windows — Linux uses Web Bluetooth in renderer instead
const noble = (
  process.platform === 'linux'
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@stoprocent/noble') as NobleApi)
) satisfies NobleApi | null;

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

/** How long connect() waits for a cached peripheral to reappear after sleep/wake. */
export const NOBLE_PERIPHERAL_SCAN_WAIT_MS = 30_000;

export interface NobleBleDisconnectOptions {
  /** When false, skip emitting `disconnected` (e.g. connect() teardown before reconnect). */
  notify?: boolean;
}

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
/** Max wait for a prior connect() to finish before the next connect is rejected. */
const BLE_CONNECT_QUEUE_WAIT_MS = IS_DARWIN ? 60_000 : 90_000;
/** Max wait for a prior writeToRadio() to finish before the next write is rejected. */
const BLE_WRITE_QUEUE_WAIT_MS = IS_DARWIN ? 30_000 : 45_000;
/** Timeout for a single GATT writeAsync chunk. */
const BLE_WRITE_CHUNK_TIMEOUT_MS = IS_DARWIN ? 10_000 : 15_000;
/** Timeout for noble.startScanning() callback (IPC must always settle; native cb can hang). */
const BLE_START_SCAN_TIMEOUT_MS = IS_DARWIN ? 15_000 : 30_000;
/** After GATT subscribe, wait briefly for `peripheral.mtu` when still null (async negotiation on WinRT/Darwin). */
const BLE_MTU_POST_GATT_WAIT_MS = 1500;
/** Poll interval while waiting for first `peripheral.mtu` value. */
const BLE_MTU_POLL_MS = 50;

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase().replace(/-/g, '');
}

function normalizedGattProps(char: { properties?: unknown }): string[] {
  return Array.isArray(char.properties)
    ? char.properties.filter((property): property is string => typeof property === 'string')
    : [];
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

function meshcorePickBestChar(
  candidates: NobleCharacteristic[],
  score: (c: NobleCharacteristic) => number,
): NobleCharacteristic | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (score(c) > score(best) ? c : best), candidates[0]);
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
  /** Advertised / last-seen BLE RSSI in dBm; null when unknown. */
  rssi: number | null;
}

import type { MeshProtocol } from '../shared/meshProtocol';

export type NobleSessionId = MeshProtocol;

interface NobleBleSession {
  connectedPeripheral: NoblePeripheral | null;
  connectedPeripheralDisconnectHandler: (() => void) | null;
  toRadioChar: NobleCharacteristic | null;
  fromRadioChar: NobleCharacteristic | null;
  fromNumChar: NobleCharacteristic | null;
  fromRadioDataHandler: ((data: Buffer, isNotification: boolean) => void) | null;
  fromNumDataHandler: ((data: Buffer) => void) | null;
  readPumpActive: boolean;
  readPumpRequested: boolean;
  /** Set to true on disconnect/close so the read pump exits without issuing more GATT reads. */
  closing: boolean;
  /** Cleared on disconnect; avoids post-write timer firing after teardown. */
  postWriteReadPumpTimer: ReturnType<typeof setTimeout> | null;
  /** Win32+MeshCore: timer to detect silent notify (pairing may be required; do not use read pump). */
  notifyWatchdogTimer: ReturnType<typeof setTimeout> | null;
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
  /** MAC registered with BleCoexistenceCoordinator while connected. */
  registeredMac: string | null;
  /**
   * Set after link-up while GATT discovery/subscribe is still running (Meshtastic + MeshCore).
   * Mid-handshake disconnect rejects this so `connect()` fails promptly.
   * A second `connect(samePeripheral)` awaits this instead of calling `disconnect()` first,
   * which would tear down the in-progress session (Win32 duplicate IPC / strict-mode).
   */
  gattSetupInflight: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (e: unknown) => void;
  } | null;
  /**
   * Serializes writeAsync() calls so at most one GATT write is in-flight at a time.
   * Noble's _withDisconnectHandler adds a disconnect:${uuid} listener per in-flight
   * operation; concurrent writes accumulate past Noble's 10-listener limit.
   */
  writeQueue: Promise<void>;
  /** Sanitized ATT MTU (23–517) from Noble `peripheral.mtu` / `mtu` events; drives write chunking. */
  attMtuSanitized: number;
  /** True after first `console.debug` for Noble-reported MTU below 23 (binding quirks, e.g. raw 20 on Darwin). */
  attMtuSuspiciousLogged: boolean;
  /** Bound handler removed on disconnect; NobleMac emits `mtu` asynchronously vs `connectAsync`. */
  peripheralMtuHandler: ((rawMtu: number) => void) | null;
  /** Set when GATT subscriptions are ready; used for long-session health and refresh. */
  sessionEstablishedAtMs: number | null;
  /** Last peripheral id for controlled long-session Noble recycle. */
  lastConnectedPeripheralId: string | null;
}

export class NobleBleManager extends EventEmitter {
  private readonly sessions = new Map<NobleSessionId, NobleBleSession>();
  /** Serializes connect() calls across all sessions to prevent native CBCentralManager races. */
  private connectQueue: Promise<void> = Promise.resolve();
  private readonly knownPeripherals = new Map<string, NoblePeripheral>();
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
  /** Deduplicates concurrent doStartScanning calls until the native start callback completes or times out. */
  private scanStartInFlight: Promise<void> | null = null;
  private lastAdapterState = noble?.state ?? 'unknown';
  private releaseHandlesCallCount = 0;

  constructor() {
    super();
    if (!noble) {
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

    noble.on('discover', (peripheral: NoblePeripheral) => {
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
      const rssi =
        typeof peripheral.rssi === 'number' && Number.isFinite(peripheral.rssi)
          ? peripheral.rssi
          : null;
      this.knownPeripherals.set(id, peripheral);
      // Re-emit on rediscover so Connection pickers can refresh RSSI (not first-seen only).
      this.emit('deviceDiscovered', { deviceId: id, deviceName: name, rssi });
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
      notifyWatchdogTimer: null,
      fromRadioNotifyOnly: false,
      fromRadioDeliveryCount: 0,
      fromRadioDeliveryBytes: 0,
      firstPacketLogged: false,
      connectStartedAtMs: null,
      fromRadioUsedReadPumpFallback: false,
      meshcoreLinuxEarlyReadPollAttempts: 0,
      registeredMac: null,
      gattSetupInflight: null,
      writeQueue: Promise.resolve(),
      attMtuSanitized: attMtuOrDefault(null),
      attMtuSuspiciousLogged: false,
      peripheralMtuHandler: null,
      sessionEstablishedAtMs: null,
      lastConnectedPeripheralId: null,
    };
  }

  private getSession(sessionId: NobleSessionId): NobleBleSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown noble session: ${sessionId}`);
    return session;
  }

  private clearSessionState(session: NobleBleSession): void {
    const peri = session.connectedPeripheral;
    const mtuHandler = session.peripheralMtuHandler;
    if (peri && mtuHandler) {
      try {
        peri.removeListener?.('mtu', mtuHandler);
      } catch {
        // catch-no-log-ok peripheral mtu listener cleanup — session teardown
      }
    }
    session.peripheralMtuHandler = null;
    if (session.gattSetupInflight) {
      try {
        session.gattSetupInflight.reject(new Error('BLE session cleared'));
      } catch {
        // catch-no-log-ok promise may already be settled
      }
      session.gattSetupInflight = null;
    }
    // Signal any in-flight read pump to exit without issuing more GATT reads.
    session.closing = true;
    if (session.postWriteReadPumpTimer !== null) {
      clearTimeout(session.postWriteReadPumpTimer);
      session.postWriteReadPumpTimer = null;
    }
    if (session.notifyWatchdogTimer !== null) {
      clearTimeout(session.notifyWatchdogTimer);
      session.notifyWatchdogTimer = null;
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
    session.registeredMac = null;
    session.writeQueue = Promise.resolve();
    session.attMtuSanitized = attMtuOrDefault(null);
    session.attMtuSuspiciousLogged = false;
    session.sessionEstablishedAtMs = null;
    session.lastConnectedPeripheralId = null;
  }

  private updateSessionAttMtuFromRaw(
    sessionId: NobleSessionId,
    session: NobleBleSession,
    raw: number | null | undefined,
    source: 'event' | 'poll',
  ): void {
    if (raw != null && typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw < 23) {
      if (!session.attMtuSuspiciousLogged) {
        session.attMtuSuspiciousLogged = true;
        console.debug(
          `[BLE:${sessionId}] reported MTU=${raw} (< spec min 23); treating as ATT default 23 for write sizing (Noble/binding quirk; NobleMac native emits values such as 20 before a full exchange).`,
        );
      }
    }
    const sanitized = attMtuOrDefault(typeof raw === 'number' ? raw : null);
    session.attMtuSanitized = sanitized;
    if (source === 'event') {
      console.debug(
        `[BLE:${sessionId}] MTU updated: ${raw} (effective ATT ${sanitized} for writes)`,
      );
    }
  }

  private attachNoblePeripheralMtuListener(
    sessionId: NobleSessionId,
    session: NobleBleSession,
    peripheral: NoblePeripheral,
  ): void {
    if (session.peripheralMtuHandler) {
      try {
        peripheral.removeListener?.('mtu', session.peripheralMtuHandler);
      } catch {
        // catch-no-log-ok re-attach mtu listener
      }
    }
    const handler = (rawMtu: number) => {
      this.updateSessionAttMtuFromRaw(sessionId, session, rawMtu, 'event');
    };
    session.peripheralMtuHandler = handler;
    peripheral.on('mtu', handler);
    if (peripheral.mtu != null) {
      this.updateSessionAttMtuFromRaw(sessionId, session, peripheral.mtu, 'poll');
    }
  }

  private async waitForNoblePeripheralMtuSettled(
    sessionId: NobleSessionId,
    session: NobleBleSession,
    peripheral: NoblePeripheral,
  ): Promise<void> {
    const deadline = Date.now() + BLE_MTU_POST_GATT_WAIT_MS;
    while (Date.now() < deadline) {
      if (peripheral.mtu != null) {
        this.updateSessionAttMtuFromRaw(sessionId, session, peripheral.mtu, 'poll');
        return;
      }
      await new Promise<void>((r) => setTimeout(r, BLE_MTU_POLL_MS));
    }
    this.updateSessionAttMtuFromRaw(sessionId, session, peripheral.mtu ?? null, 'poll');
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
      if (session.notifyWatchdogTimer !== null) {
        clearTimeout(session.notifyWatchdogTimer);
        session.notifyWatchdogTimer = null;
      }
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
   * - MeshCore + Win32 + notify active: skip reads — WinRT returns "Protocol error" on NUS TX GATT reads
   *   (NUS TX is effectively notify-only). Rely on notify only. If notify is silent for 5s, we log
   *   a hint to pair in Windows Settings first — we do not fall back to reads (that caused spurious protocol errors).
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

  /** Snapshot for long-session main-process health logs. */
  getLongSessionHealthSnapshot(): {
    meshcoreConnected: boolean;
    meshtasticConnected: boolean;
    bleSessionActive: boolean;
    scanningActive: boolean;
    sessions: {
      meshtastic: ReturnType<typeof sessionDetail>;
      meshcore: ReturnType<typeof sessionDetail>;
    };
  } {
    const sessionDetail = (sessionId: 'meshtastic' | 'meshcore') => {
      const session = this.getSession(sessionId);
      const established = session.sessionEstablishedAtMs;
      return {
        connected: this.isConnected(sessionId),
        peripheralId: session.lastConnectedPeripheralId,
        sessionAgeSec: established != null ? Math.floor((Date.now() - established) / 1000) : null,
        postWriteTimer: session.postWriteReadPumpTimer !== null,
        notifyWatchdog: session.notifyWatchdogTimer !== null,
        gattInflight: session.gattSetupInflight !== null,
        readPumpActive: session.readPumpActive,
        fromRadioPackets: session.fromRadioDeliveryCount,
      };
    };
    return {
      meshcoreConnected: this.isConnected('meshcore'),
      meshtasticConnected: this.isConnected('meshtastic'),
      bleSessionActive: this.isBleSessionActive(),
      scanningActive: this.scanningActive,
      sessions: {
        meshtastic: sessionDetail('meshtastic'),
        meshcore: sessionDetail('meshcore'),
      },
    };
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
    await bleCoexistenceCoordinator.acquireScan('noble');
    // Clear known peripherals so every device is re-emitted as discovered on each new scan.
    // Without this, devices found in a previous scan are never re-emitted (isNew = false),
    // so the picker stays empty on second and subsequent scan attempts.
    // Preserve peripherals already connected in noble — they won't re-advertise during a
    // scan, so keep them available for connect() and re-emit for auto-connect / picker.
    const stillConnected: [string, NoblePeripheral][] = [];
    for (const [id, peripheral] of this.knownPeripherals.entries()) {
      if (peripheral.state === 'connected') stillConnected.push([id, peripheral]);
    }
    this.knownPeripherals.clear();
    for (const [id, peripheral] of stillConnected) {
      this.knownPeripherals.set(id, peripheral);
      const name: string = peripheral.advertisement?.localName || peripheral.address || id;
      const rssi =
        typeof peripheral.rssi === 'number' && Number.isFinite(peripheral.rssi)
          ? peripheral.rssi
          : null;
      this.emit('deviceDiscovered', { deviceId: id, deviceName: name, rssi });
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
      bleCoexistenceCoordinator.releaseScan('noble');
    } else {
      // Other sessions still want to scan; restart with updated filter.
      // e.g. meshcore stopped → switch from open scan back to meshtastic-only filter.
      await this.doStartScanning();
    }
  }

  /** Stop all scanning immediately — used for app quit and force-quit IPC. */
  async stopAllScanning(): Promise<void> {
    if (this.sessions.size === 0) return;
    this.scanRequesters.clear();
    await this.doStopScanning();
    bleCoexistenceCoordinator.releaseScan('noble');
  }

  /** Pause Noble scan for an external stack (Reticulum btleplug) without dropping GATT links. */
  async pauseScanningForExternalScan(): Promise<void> {
    if (this.scanningActive) {
      await this.doStopScanning();
    }
  }

  /** Resume Noble scan after external scan if mesh sessions still request discovery. */
  async resumeScanningAfterExternalScan(): Promise<void> {
    if (this.scanRequesters.size > 0 && this.adapterReady && !this.scanningActive) {
      await this.doStartScanning();
    }
  }

  /**
   * Scan until `peripheralId` appears in `knownPeripherals` (e.g. after macOS sleep clears cache).
   * Failure point: radio off or out of range — caller surfaces connect error.
   */
  private waitForPeripheralDuringScan(
    sessionId: NobleSessionId,
    peripheralId: string,
    timeoutMs: number,
  ): Promise<NoblePeripheral> {
    const cached = this.knownPeripherals.get(peripheralId);
    if (cached) return Promise.resolve(cached);

    return new Promise((resolve, reject) => {
      let settled = false;
      const onDiscovered = (device: { deviceId: string }) => {
        if (device.deviceId !== peripheralId) return;
        const peripheral = this.knownPeripherals.get(peripheralId);
        if (!peripheral) return;
        finish(() => {
          resolve(peripheral);
        });
      };

      const timer = setTimeout(() => {
        finish(() => {
          reject(
            new Error(
              `BLE peripheral not found: ${peripheralId}. Scan for devices before connecting.`,
            ),
          );
        });
      }, timeoutMs);

      const releaseEphemeralScanInterest = () => {
        if (hadScanInterest) return;
        this.scanRequesters.delete(sessionId);
        void (
          this.scanRequesters.size === 0 ? this.doStopScanning() : this.doStartScanning()
        ).catch((err: unknown) => {
          console.debug(
            '[NobleBleManager] waitForPeripheralDuringScan scan teardown ',
            sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
          );
        });
      };

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.off('deviceDiscovered', onDiscovered);
        releaseEphemeralScanInterest();
        fn();
      };

      this.on('deviceDiscovered', onDiscovered);
      const hadScanInterest = this.scanRequesters.has(sessionId);
      if (!hadScanInterest) {
        this.scanRequesters.add(sessionId);
      }
      void this.doStartScanning().catch((err: unknown) => {
        if (!hadScanInterest) {
          this.scanRequesters.delete(sessionId);
        }
        finish(() => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });
    });
  }

  private doStartScanning(): Promise<void> {
    if (!noble) return Promise.resolve();
    // Idempotent: if a scan is already active (e.g. kicked by stateChange handler concurrently),
    // skip the duplicate noble.startScanning() call.
    if (this.scanningActive) return Promise.resolve();
    if (this.scanStartInFlight) return this.scanStartInFlight;

    this.scanStartInFlight = this.runDoStartScanningWithTimeout().finally(() => {
      this.scanStartInFlight = null;
    });
    return this.scanStartInFlight;
  }

  /**
   * noble.startScanning's callback is not guaranteed to fire (same class of issue as stopScanning).
   * Bound the wait so IPC handlers always get a reply; single-flight is enforced by scanStartInFlight.
   *
   * Uses an inline timer (not Promise.race) so `abandoned` is set synchronously before reject,
   * avoiding a race where a late native callback could set scanningActive after we time out.
   */
  private runDoStartScanningWithTimeout(): Promise<void> {
    const nobleApi = noble;
    if (!nobleApi) return Promise.resolve();
    const filter = this.computeScanFilter();
    let abandoned = false;

    return new Promise<void>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const clearTimer = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      };

      timeoutId = setTimeout(() => {
        abandoned = true;
        clearTimer();
        if (!this.scanningActive) {
          try {
            nobleApi.stopScanning();
          } catch (stopErr) {
            console.debug('[NobleBleManager] stopScanning after start timeout (ignored):', stopErr); // log-injection-ok noble internal error
          }
        }
        reject(new Error(`noble.startScanning timed out after ${BLE_START_SCAN_TIMEOUT_MS}ms`));
      }, BLE_START_SCAN_TIMEOUT_MS);

      nobleApi.startScanning(filter, false, (err: Error | null) => {
        if (abandoned) {
          if (!err) {
            try {
              nobleApi.stopScanning();
            } catch (stopErr) {
              console.debug(
                '[NobleBleManager] stopScanning after abandoned start callback (ignored):',
                stopErr,
              ); // log-injection-ok noble internal error
            }
          }
          return;
        }
        clearTimer();
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
    if (!noble || !this.scanningActive) return Promise.resolve();
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
    if (!noble) {
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

  /**
   * Await in-flight GATT setup for the same session+peripheral without joining connectQueue.
   * Concurrent duplicate connects coalesce here instead of serializing behind the first open
   * and then disconnecting mid-handshake.
   * @returns true when the caller should return (ready or already connected).
   */
  private async tryCoalesceInflightGattConnect(
    sessionId: NobleSessionId,
    peripheralId: string,
  ): Promise<boolean> {
    const session = this.getSession(sessionId);
    const knownPeripheral = this.knownPeripherals.get(peripheralId);
    if (
      knownPeripheral &&
      session.connectedPeripheral?.id === knownPeripheral.id &&
      session.toRadioChar &&
      session.fromRadioChar &&
      !session.closing
    ) {
      console.debug(
        `[BLE:${sessionId}] connect idempotent skip — already connected to ${peripheralId} (duplicate IPC would disconnect and break handshake)`,
      );
      return true;
    }
    if (
      peripheralId !== knownPeripheral?.id ||
      session.connectedPeripheral?.id !== knownPeripheral.id ||
      !session.gattSetupInflight ||
      session.closing
    ) {
      return false;
    }
    console.debug(
      `[BLE:${sessionId}] connect coalesce — awaiting in-flight GATT setup for ${peripheralId} (avoid disconnect during discovery)`,
    );
    try {
      await session.gattSetupInflight.promise;
    } catch (err) {
      console.debug(
        `[BLE:${sessionId}] connect coalesce await failed — ${sanitizeLogMessage(err instanceof Error ? err.message : String(err))}`,
      );
      // First attempt failed or session cleared; fall through to full reconnect.
      return false;
    }
    if (
      session.toRadioChar &&
      session.fromRadioChar &&
      session.connectedPeripheral?.id === knownPeripheral.id &&
      !session.closing
    ) {
      console.debug(`[BLE:${sessionId}] connect coalesce done — session ready for ${peripheralId}`);
      return true;
    }
    return false;
  }

  async connect(sessionId: NobleSessionId, peripheralId: string): Promise<void> {
    // Do not reject solely because `noble` is null: Linux production skips the native
    // binding, and Linux CI behavior tests seed knownPeripherals + sessions without it.
    // Scan paths still require noble (checked where startScanning/scanStop is used).
    // Coalesce before the queue so a duplicate connect awaits GATT setup instead of
    // waiting for the first holder to finish and then tearing the session down.
    if (await this.tryCoalesceInflightGattConnect(sessionId, peripheralId)) {
      return;
    }

    // Serialize across all sessions — noble's native CBCentralManager crashes (SIGSEGV/SIGBUS)
    // if a second peripheral's discoverServices/subscribe races with the first.
    const prevQueue = this.connectQueue;
    let releaseQueue!: () => void;
    this.connectQueue = new Promise<void>((r) => {
      releaseQueue = r;
    });
    await withTimeout(prevQueue, BLE_CONNECT_QUEUE_WAIT_MS, 'BLE connect queue wait');

    const session = this.getSession(sessionId);
    let peripheral: NoblePeripheral | null = null;
    let connected = false;
    const peripheralOwner: BlePeripheralOwner =
      sessionId === 'meshcore' ? 'noble:meshcore' : 'noble:meshtastic';
    console.debug(
      `[BLE:${sessionId}] connect start — peripheralId=${peripheralId} adapterReady=${this.adapterReady} scanRequesters=[${[...this.scanRequesters].join(',')}]`,
    );
    try {
      // Fail before scan/GATT so Reticulum BLE RNode can keep CoreBluetooth exclusively.
      bleCoexistenceCoordinator.assertCanConnect(peripheralOwner, peripheralId);
      if (!this.adapterReady) {
        throw new Error('Bluetooth adapter is not powered on');
      }
      // CBCentralManager on macOS cannot scan and connect simultaneously.
      // Stop scanning without clearing scanRequesters — it will resume in the finally block.
      // On Windows (WinRT) this restriction does not apply.
      if (process.platform === 'darwin' && this.scanningActive) {
        await this.doStopScanning();
      }
      // Re-check after queue wait — first connect may have finished (or still be setting up
      // only if another session held the queue; same-session GATT is usually done by then).
      if (await this.tryCoalesceInflightGattConnect(sessionId, peripheralId)) {
        return;
      }
      await this.disconnect(sessionId, { notify: false });
      // Re-open a fresh session (disconnect sets closing=true; reset it for the new connection).
      session.closing = false;

      peripheral = this.knownPeripherals.get(peripheralId) ?? null;
      if (!peripheral) {
        console.debug(
          `[BLE:${sessionId}] peripheral ${peripheralId} not in cache — scanning up to ${NOBLE_PERIPHERAL_SCAN_WAIT_MS}ms`,
        );
        peripheral = await this.waitForPeripheralDuringScan(
          sessionId,
          peripheralId,
          NOBLE_PERIPHERAL_SCAN_WAIT_MS,
        );
      }
      const connectRssi =
        typeof peripheral.rssi === 'number' && Number.isFinite(peripheral.rssi)
          ? peripheral.rssi
          : null;
      console.debug(
        `[BLE:${sessionId}] peripheral info — address=${peripheral.address ?? 'unknown'} addressType=${peripheral.addressType ?? 'unknown'} rssi=${connectRssi ?? 'unknown'} state=${peripheral.state} platform=${process.platform}`,
      );
      // Refresh picker / connecting banner with connect-time RSSI (scan may have been empty).
      this.emit('deviceDiscovered', {
        deviceId: peripheralId,
        deviceName: peripheral.advertisement?.localName || peripheral.address || peripheralId,
        rssi: connectRssi,
      });
      bleCoexistenceCoordinator.assertCanConnect(
        peripheralOwner,
        peripheral.address ?? peripheralId,
      );
      session.connectStartedAtMs = Date.now();
      session.firstPacketLogged = false;
      session.fromRadioUsedReadPumpFallback = false;
      session.meshcoreLinuxEarlyReadPollAttempts = 0;

      if (peripheral.state === 'connected' || peripheral.state === 'connecting') {
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
        // Peripheral is connected/connecting in noble but not usable (e.g. macOS wake zombie).
        // NOTE: register onDisconnected AFTER this cleanup so pre-connect disconnectAsync()
        // does not prematurely trigger the handler and wipe the new session state.
        if (peripheral.state === 'connecting') {
          console.warn(
            `[BLE:${sessionId}] peripheral stale state=connecting — forcing disconnect before reconnect`,
          );
        } else if (peripheral.state === 'connected' && !releasedOtherSession) {
          console.warn(
            `[BLE:${sessionId}] peripheral already connected in noble — disconnecting before reconnect`,
          );
        }
        if (
          (peripheral.state === 'connected' && !releasedOtherSession) ||
          peripheral.state === 'connecting'
        ) {
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
        this.knownPeripherals.delete(peripheralId);
        const stateAfterDisconnect: string = peripheral.state;
        if (stateAfterDisconnect !== 'disconnected') {
          peripheral = await this.waitForPeripheralDuringScan(
            sessionId,
            peripheralId,
            NOBLE_PERIPHERAL_SCAN_WAIT_MS,
          );
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
      // Failure point: NobleMac / WinRT may emit `mtu` only after connectAsync; values <23 are coerced (see `bleAttWriteLimit.ts`).
      this.attachNoblePeripheralMtuListener(sessionId, session, peripheral);

      // Stop scanning before connecting — many Linux/BlueZ drivers abort connections while scanning.
      if (this.scanningActive) {
        const nobleApi = noble;
        if (!nobleApi) {
          throw new Error('Noble BLE is unavailable on this platform');
        }
        console.debug(`[BLE:${sessionId}] stopping scan before connect`);
        await new Promise<void>((resolve) => {
          const onScanStop = () => {
            nobleApi.removeListener('scanStop', onScanStop);
            resolve();
          };
          nobleApi.on('scanStop', onScanStop);
          void this.doStopScanning();
        });
      }

      const tConnect = Date.now();
      try {
        await withTimeout(peripheral.connectAsync(), BLE_CONNECT_TIMEOUT_MS, 'BLE connectAsync');
      } catch (err) {
        this.knownPeripherals.delete(peripheralId);
        try {
          await withTimeout(
            peripheral.disconnectAsync(),
            5000,
            'BLE post-connect-failure disconnectAsync',
          );
        } catch (disconnectErr) {
          console.debug(
            `[BLE:${sessionId}] post-connect-failure disconnect error (ignored):`,
            sanitizeLogMessage(
              disconnectErr instanceof Error ? disconnectErr.message : String(disconnectErr),
            ),
          );
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
      {
        let resolveGatt!: () => void;
        let rejectGatt!: (e: unknown) => void;
        const promise = new Promise<void>((resolve, reject) => {
          resolveGatt = resolve;
          rejectGatt = reject;
        });
        // Avoid unhandledRejection when no duplicate connect is awaiting coalesce.
        // catch-no-log-ok coalesce tail — duplicate connects await the same promise; lone setup uses this
        void promise.catch(() => {});
        session.gattSetupInflight = {
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
      let characteristics: NobleCharacteristic[];
      if (meshcoreWinFullDiscovery) {
        const all = await withTimeout<NobleDiscoveryResult>(
          peripheral.discoverAllServicesAndCharacteristicsAsync(),
          BLE_DISCOVERY_TIMEOUT_MS,
          'BLE full GATT discovery (meshcore Win32)',
        );
        characteristics = all.characteristics;
      } else {
        const discovered = await withTimeout<NobleDiscoveryResult>(
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
        const rxCandidates: NobleCharacteristic[] = [];
        const txCandidates: NobleCharacteristic[] = [];
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
            .map((c) => `${normalizeUuid(c.uuid)}[${(c.properties ?? []).join(',')}]`)
            .join(', ')}`,
        );
      }

      // FROMNUM is optional for notification-based flow; require only TX/RX characteristics.
      if (!session.toRadioChar || !session.fromRadioChar) {
        console.warn(
          `[BLE:${sessionId}] missing required chars — toRadio=${Boolean(session.toRadioChar)} fromRadio=${Boolean(session.fromRadioChar)} discoveredUuids=${characteristics.map((c) => c.uuid).join(',')}`, // log-injection-ok noble internal characteristic UUIDs
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
          if (IS_WIN32 && sessionId === 'meshcore') {
            session.notifyWatchdogTimer = setTimeout(() => {
              session.notifyWatchdogTimer = null;
              if (session.closing || session.fromRadioDeliveryCount > 0) return;
              const msg =
                'BLE notify silent on Windows: pair the radio in Windows Settings → Bluetooth first (use the PIN shown on the device), then retry Connect.';
              console.warn(`[BLE:meshcore] notify watchdog: no data in 5s on Win32. ${msg}`);
              this.emit('connect-aborted', { sessionId, message: msg });
            }, 5_000);
          }
        } catch (err) {
          console.warn(
            `[BLE:${sessionId}] fromRadio subscribe failed; falling back to read-pump (hasNotify=${fromRadioSupportsNotify} canRead=${fromRadioCanRead}):`,
            sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
          );
          // fromRadioSupportsNotify is always true here (outer `if`); Win32+meshcore
          // cannot fall back to read-pump after a failed notify subscribe.
          if (IS_WIN32 && sessionId === 'meshcore') {
            console.warn(
              `[BLE:meshcore] subscribe failed on Win32 with notify-capable NUS TX (read fallback would hit WinRT protocol errors). Pair the device in Windows Settings → Bluetooth first (PIN shown on the radio), then retry Connect.`,
            );
            throw new Error(
              'BLE notify subscribe failed on Windows. Pair the device in Windows Settings (use the PIN on the device), then retry.',
            );
          }
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

      await this.waitForNoblePeripheralMtuSettled(sessionId, session, peripheral);

      // One-shot initial read in case the device already queued bytes before the first FROMNUM notify.
      this.requestFromRadioReadPump(sessionId);

      if (session.gattSetupInflight) {
        session.gattSetupInflight.resolve();
        session.gattSetupInflight = null;
      }
      logDeviceConnection(
        `transport=ble stack=${sessionId} peripheralId=${sanitizeLogMessage(peripheralId)} mac=${sanitizeLogMessage(peripheral.address ?? 'unknown')}`,
      );
      const registeredMac = peripheral.address ?? peripheralId;
      bleCoexistenceCoordinator.register(registeredMac, peripheralOwner);
      session.registeredMac = registeredMac;
      session.lastConnectedPeripheralId = peripheralId;
      session.sessionEstablishedAtMs = Date.now();
      this.emit('connected', { sessionId });
    } catch (err) {
      console.warn(`[BLE:${sessionId}] connect failed:`, err instanceof Error ? err.message : err); // log-injection-ok noble internal error
      if (session.gattSetupInflight) {
        try {
          session.gattSetupInflight.reject(err instanceof Error ? err : new Error(String(err)));
        } catch {
          // catch-no-log-ok promise may already be settled
        }
        session.gattSetupInflight = null;
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
      if (peripheral) {
        try {
          peripheral.removeAllListeners('mtu');
        } catch {
          // catch-no-log-ok peripheral mtu listener cleanup in connect error path
        }
      }
      this.clearSessionState(session);
      // Mid-GATT OS drops often leave state=disconnected; skip cleanup disconnect.
      // When still "connected", bound disconnectAsync — NobleMac can hang forever and
      // block IPC / the renderer Noble connect mutex (90s reconnect budget burn).
      if (connected && peripheral && peripheral.state !== 'disconnected') {
        try {
          await withTimeout(
            peripheral.disconnectAsync(),
            5000,
            'BLE connect-error disconnectAsync',
          );
        } catch (e: unknown) {
          console.debug(
            '[noble-ble] connect error cleanup disconnect ' +
              sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
          );
        }
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
    // Serialize writes: each writeAsync() adds a disconnect:${uuid} listener to Noble via
    // _withDisconnectHandler; concurrent writes accumulate past Noble's 10-listener limit.
    const prev = session.writeQueue;
    let release!: () => void;
    session.writeQueue = new Promise<void>((r) => {
      release = r;
    });
    try {
      await withTimeout(prev, BLE_WRITE_QUEUE_WAIT_MS, 'BLE write queue wait');
      if (!session.toRadioChar)
        throw new Error(`Disconnected before write could execute for session ${sessionId}`);
      const peripheral = session.connectedPeripheral;
      const rawMtu =
        peripheral != null && typeof peripheral.mtu === 'number' && Number.isFinite(peripheral.mtu)
          ? peripheral.mtu
          : session.attMtuSanitized;
      const limit = maxWriteRequestPayloadBytes(rawMtu);
      for (let offset = 0; offset < data.length; offset += limit) {
        const end = Math.min(offset + limit, data.length);
        const chunk = data.subarray(offset, end);
        await withTimeout(
          session.toRadioChar.writeAsync(chunk, false),
          BLE_WRITE_CHUNK_TIMEOUT_MS,
          'BLE writeAsync',
        );
      }
    } finally {
      release();
    }
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

  async disconnect(sessionId: NobleSessionId, options?: NobleBleDisconnectOptions): Promise<void> {
    const notify = options?.notify !== false;
    const session = this.getSession(sessionId);
    const peripheral = session.connectedPeripheral;
    const fromRadio = session.fromRadioChar;
    const fromNum = session.fromNumChar;
    const onPeripheralDisconnect = session.connectedPeripheralDisconnectHandler;
    const onFromRadioData = session.fromRadioDataHandler;
    const onFromNumData = session.fromNumDataHandler;

    if (!peripheral && !session.toRadioChar && !fromRadio && !fromNum) return;
    const peripheralOwner: BlePeripheralOwner =
      sessionId === 'meshcore' ? 'noble:meshcore' : 'noble:meshtastic';
    if (session.registeredMac) {
      bleCoexistenceCoordinator.unregister(session.registeredMac, peripheralOwner);
    }
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
      if (notify) {
        this.emit('disconnected', { sessionId });
      }
    }
  }

  async disconnectAllSessions(): Promise<void> {
    await this.disconnectAll();
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
