import { EventEmitter } from 'events';

import { withTimeout } from '../shared/withTimeout';
import { sanitizeLogMessage } from './log-service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const noble = require('@stoprocent/noble') as any;

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

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase().replace(/-/g, '');
}

export interface NobleBleDevice {
  deviceId: string;
  deviceName: string;
}

export type NobleSessionId = 'meshtastic' | 'meshcore';

interface NobleBleSession {
  connectedPeripheral: any | null;
  connectedPeripheralDisconnectHandler: (() => void) | null;
  toRadioChar: any | null;
  fromRadioChar: any | null;
  fromNumChar: any | null;
  fromRadioDataHandler: ((data: Buffer) => void) | null;
  fromNumDataHandler: ((data: Buffer) => void) | null;
  readPumpActive: boolean;
  readPumpRequested: boolean;
  /** Set to true on disconnect/close so the read pump exits without issuing more GATT reads. */
  closing: boolean;
  /** Cleared on disconnect; avoids post-write timer firing after teardown. */
  postWriteReadPumpTimer: ReturnType<typeof setTimeout> | null;
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

  constructor() {
    super();
    this.sessions.set('meshtastic', this.createSessionState());
    this.sessions.set('meshcore', this.createSessionState());
    // Seed from the current synchronous state in case noble already transitioned before
    // this manager was constructed (avoids false "adapter not powered on" errors on startup).
    this.adapterReady = noble.state === 'poweredOn';
    noble.on('stateChange', (state: string) => {
      this.adapterReady = state === 'poweredOn';
      this.emit('adapterState', state);
      if (this.adapterReady && this.scanRequesters.size > 0) {
        void this.doStartScanning().catch((err) => {
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
    };
  }

  private getSession(sessionId: NobleSessionId): NobleBleSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown noble session: ${sessionId}`);
    return session;
  }

  private clearSessionState(session: NobleBleSession): void {
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
  }

  private requestFromRadioReadPump(sessionId: NobleSessionId): void {
    const session = this.getSession(sessionId);
    if (session.closing) return;
    session.readPumpRequested = true;
    if (session.readPumpActive) return;
    session.readPumpActive = true;
    void this.runFromRadioReadPump(sessionId);
  }

  private async runFromRadioReadPump(sessionId: NobleSessionId): Promise<void> {
    const session = this.getSession(sessionId);
    try {
      console.debug(`[BLE:${sessionId}] read pump start`);
      while (session.readPumpRequested && !session.closing) {
        session.readPumpRequested = false;
        if (!session.fromRadioChar || !session.connectedPeripheral) return;
        for (let i = 0; i < BLE_READ_PUMP_MAX_ITERATIONS; i++) {
          // Exit immediately if session was torn down between reads.
          if (session.closing || session.connectedPeripheral?.state !== 'connected') {
            console.debug(`[BLE:${sessionId}] read pump: peripheral disconnected, exiting`);
            return;
          }
          if (!session.fromRadioChar) {
            console.debug(`[BLE:${sessionId}] read pump: fromRadioChar gone, exiting`);
            return;
          }
          let data: Buffer;
          const t0 = Date.now();
          try {
            console.debug(`[BLE:${sessionId}] readAsync #${i} start`);
            data = await withTimeout<Buffer>(
              session.fromRadioChar.readAsync(),
              BLE_FROM_RADIO_READ_TIMEOUT_MS,
              'BLE fromRadio read',
            );
            console.debug(
              `[BLE:${sessionId}] readAsync #${i} done: ${data?.length ?? 0} bytes in ${Date.now() - t0}ms`,
            );
          } catch (err) {
            console.warn(
              `[BLE:${sessionId}] readAsync #${i} error after ${Date.now() - t0}ms:`,
              sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
            );
            // Back off before the outer while can re-trigger to avoid hammering a failing characteristic.
            await new Promise<void>((r) => setTimeout(r, 500));
            break;
          }
          if (!data || data.length === 0) {
            console.debug(`[BLE:${sessionId}] readAsync #${i} empty — draining done`);
            break;
          }
          console.debug(`[BLE:${sessionId}] emitting fromRadio: ${data.length} bytes → renderer`);
          this.emit('fromRadio', { sessionId, bytes: new Uint8Array(Buffer.from(data)) });
          // Small floor delay between consecutive reads to avoid flooding the CBQueue.
          await new Promise<void>((r) => setTimeout(r, 10));
        }
      }
    } finally {
      session.readPumpActive = false;
      console.debug(`[BLE:${sessionId}] read pump stop`);
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
    if (!this.adapterReady) throw new Error('Bluetooth adapter is not powered on');
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
    // Mark all sessions closing FIRST so any in-flight readAsync loop exits without issuing
    // more GATT reads. This prevents the CBCentralManager delegate firing into freed memory
    // after _bindings.stop() releases the native handle.
    for (const session of this.sessions.values()) {
      session.closing = true;
    }
    // Clear scan requesters to prevent any deferred scan restart during teardown.
    this.scanRequesters.clear();
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
    this.removeAllListeners();
    // Release the native BLEManager and its CBqueue dispatch queue (macOS only).
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
      if (this.scanningActive) {
        await this.doStopScanning();
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

      if (peripheral.state === 'connected') {
        // Check if any other session already owns this peripheral. If so, refuse to connect
        // rather than destructively disconnecting the other session's active GATT link.
        for (const [otherSessionId, otherSession] of this.sessions.entries()) {
          if (
            otherSessionId !== sessionId &&
            otherSession.connectedPeripheral?.id === peripheral.id
          ) {
            throw new Error(
              `Peripheral ${peripheral.id} is already in use by the ${otherSessionId} session`,
            );
          }
        }
        // Peripheral is connected in noble's internal state but not claimed by any session
        // (e.g. leftover from a previous crashed session). Disconnect before reconnecting.
        // NOTE: register onDisconnected AFTER this cleanup so the pre-connect disconnectAsync()
        // does not prematurely trigger the handler and wipe the new session state.
        console.warn(
          `[BLE:${sessionId}] peripheral already connected in noble — disconnecting before reconnect`,
        );
        try {
          await withTimeout(peripheral.disconnectAsync(), 5000, 'BLE pre-connect disconnectAsync');
        } catch (err) {
          console.debug(
            `[BLE:${sessionId}] pre-connect disconnect error (ignored):`,
            sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
          );
        }
      }

      const onDisconnected = () => {
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
      await withTimeout(peripheral.connectAsync(), 15000, 'BLE connectAsync');
      connected = true;

      const isMeshcore = sessionId === 'meshcore';
      const discoverServiceUuids = isMeshcore ? [MESHCORE_SERVICE_UUID] : [SERVICE_UUID];
      const discoverCharUuids = isMeshcore
        ? [MESHCORE_RX_UUID, MESHCORE_TX_UUID]
        : [TORADIO_UUID, FROMRADIO_UUID, FROMNUM_UUID];

      const { characteristics } = await withTimeout<{
        characteristics: any[];
      }>(
        peripheral.discoverSomeServicesAndCharacteristicsAsync(
          discoverServiceUuids,
          discoverCharUuids,
        ),
        15000,
        'BLE characteristic discovery',
      );
      for (const char of characteristics) {
        const uuid = normalizeUuid(char.uuid);
        if (isMeshcore) {
          if (uuid === MESHCORE_RX_UUID) session.toRadioChar = char;
          else if (uuid === MESHCORE_TX_UUID) session.fromRadioChar = char;
        } else {
          if (uuid === TORADIO_UUID) session.toRadioChar = char;
          else if (uuid === FROMRADIO_UUID) session.fromRadioChar = char;
          else if (uuid === FROMNUM_UUID) session.fromNumChar = char;
        }
      }
      console.debug(
        `[BLE:${sessionId}] discovered chars — toRadio=${Boolean(session.toRadioChar)} fromRadio=${Boolean(session.fromRadioChar)} fromNum=${Boolean(session.fromNumChar)} toRadioProps=${JSON.stringify(session.toRadioChar?.properties)} fromRadioProps=${JSON.stringify(session.fromRadioChar?.properties)} fromNumProps=${JSON.stringify(session.fromNumChar?.properties)}`,
      );

      // FROMNUM is optional for notification-based flow; require only TX/RX characteristics.
      if (!session.toRadioChar || !session.fromRadioChar) {
        throw new Error('Failed to find required BLE characteristics');
      }

      if (session.fromNumChar) {
        await withTimeout(session.fromNumChar.subscribeAsync(), 10000, 'BLE fromNum subscribe');
        session.fromNumDataHandler = () => {
          console.debug(
            `[BLE:${sessionId}] fromNum notify — pump active=${session.readPumpActive}`,
          );
          this.requestFromRadioReadPump(sessionId);
        };
        session.fromNumChar.on('data', session.fromNumDataHandler);
      }
      const fromRadioProps: string[] = Array.isArray(session.fromRadioChar.properties)
        ? session.fromRadioChar.properties
        : [];
      const fromRadioSupportsNotify =
        fromRadioProps.includes('notify') || fromRadioProps.includes('indicate');
      if (fromRadioSupportsNotify) {
        await withTimeout(session.fromRadioChar.subscribeAsync(), 10000, 'BLE fromRadio subscribe');
        session.fromRadioDataHandler = (data: Buffer) => {
          if (!data || data.length === 0) return;
          console.debug(`[BLE:${sessionId}] fromRadio notify: ${data.length} bytes`);
          this.emit('fromRadio', { sessionId, bytes: new Uint8Array(Buffer.from(data)) });
        };
        session.fromRadioChar.on('data', session.fromRadioDataHandler);
      } else {
        console.debug(`[BLE:${sessionId}] fromRadio has no notify — using read-pump path only`);
      }
      console.debug(
        `[BLE:${sessionId}] subscriptions ready — fromNum=${Boolean(session.fromNumChar)} fromRadioNotify=${fromRadioSupportsNotify}`,
      );

      session.connectedPeripheral = peripheral;
      // One-shot initial read in case the device already queued bytes before the first FROMNUM notify.
      this.requestFromRadioReadPump(sessionId);
      this.emit('connected', { sessionId });
    } catch (err) {
      console.warn(`[BLE:${sessionId}] connect failed:`, err instanceof Error ? err.message : err); // log-injection-ok noble internal error
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
        void this.doStartScanning().catch((err) => {
          console.error('[NobleBleManager] post-connect scan restart error:', err); // log-injection-ok noble internal error
        });
      }
    }
  }

  isConnected(sessionId: NobleSessionId): boolean {
    const session = this.sessions.get(sessionId);
    return session != null && session.toRadioChar != null;
  }

  async writeToRadio(sessionId: NobleSessionId, data: Buffer): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session.toRadioChar)
      throw new Error(`Not connected to a BLE device for session ${sessionId}`);
    console.debug(`[BLE:${sessionId}] writeToRadio: ${data.length} bytes`);
    await session.toRadioChar.writeAsync(data, false);
    console.debug(
      `[BLE:${sessionId}] writeToRadio done — scheduling post-write read pump in ${POST_WRITE_READ_PUMP_DELAY_MS}ms`,
    );
    // Give the device time to prepare its response, then kick the read pump.
    // fromNum notify is the primary trigger; this is a safety net for devices that are slow to notify.
    if (session.postWriteReadPumpTimer !== null) {
      clearTimeout(session.postWriteReadPumpTimer);
      session.postWriteReadPumpTimer = null;
    }
    session.postWriteReadPumpTimer = setTimeout(() => {
      session.postWriteReadPumpTimer = null;
      this.requestFromRadioReadPump(sessionId);
    }, POST_WRITE_READ_PUMP_DELAY_MS);
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
    await Promise.all(
      (['meshtastic', 'meshcore'] as NobleSessionId[]).map((sessionId) =>
        this.disconnect(sessionId),
      ),
    );
  }
}
