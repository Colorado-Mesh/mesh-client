import { EventEmitter } from 'events';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const noble = require('@abandonware/noble') as any;

// Meshtastic BLE GATT UUIDs (from @meshtastic/transport-web-bluetooth)
const SERVICE_UUID = '6ba1b21815a8461f9fa85dcae273eafd';
const TORADIO_UUID = 'f75c76d2129e4dada1dd7866124401e7';
const FROMRADIO_UUID = '2c55e69e499311edb8780242ac120002';
const FROMNUM_UUID = 'ed9da18ca8004f66a670aa7547e34453';

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase().replace(/-/g, '');
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
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
}

export class NobleBleManager extends EventEmitter {
  private readonly sessions = new Map<NobleSessionId, NobleBleSession>();
  private readonly connectInProgressSessions = new Set<NobleSessionId>();
  private readonly knownPeripherals = new Map<string, any>();
  private scanRequested = false;
  private adapterReady = false;

  constructor() {
    super();
    this.sessions.set('meshtastic', this.createSessionState());
    this.sessions.set('meshcore', this.createSessionState());
    noble.on('stateChange', (state: string) => {
      this.adapterReady = state === 'poweredOn';
      this.emit('adapterState', state);
      if (this.adapterReady && this.scanRequested) {
        void this.doStartScanning().catch((err) => {
          console.error('[NobleBleManager] deferred startScanning error:', err); // log-injection-ok noble internal error
        });
      }
    });

    noble.on('discover', (peripheral: any) => {
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
        for (let i = 0; i < 512; i++) {
          // Exit immediately if session was torn down between reads.
          if (session.closing || session.connectedPeripheral?.state !== 'connected') {
            console.debug(`[BLE:${sessionId}] read pump: peripheral disconnected, exiting`);
            return;
          }
          let data: Buffer;
          const t0 = Date.now();
          try {
            console.debug(`[BLE:${sessionId}] readAsync #${i} start`);
            data = await withTimeout<Buffer>(
              session.fromRadioChar.readAsync(),
              2000,
              'BLE fromRadio read',
            );
            console.debug(
              `[BLE:${sessionId}] readAsync #${i} done: ${data?.length ?? 0} bytes in ${Date.now() - t0}ms`,
            );
          } catch (err) {
            console.warn(
              `[BLE:${sessionId}] readAsync #${i} error after ${Date.now() - t0}ms:`,
              err instanceof Error ? err.message : err,
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
    if (this.scanRequested) return true;
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

  async startScanning(): Promise<void> {
    // Clear known peripherals so every device is re-emitted as discovered on each new scan.
    // Without this, devices found in a previous scan are never re-emitted (isNew = false),
    // so the picker stays empty on second and subsequent scan attempts.
    this.knownPeripherals.clear();
    this.scanRequested = true;
    if (!this.adapterReady) throw new Error('Bluetooth adapter is not powered on');
    await this.doStartScanning();
  }

  private doStartScanning(): Promise<void> {
    return new Promise((resolve, reject) => {
      noble.startScanning([SERVICE_UUID], false, (err: Error | null) => {
        if (err) {
          console.error('[NobleBleManager] startScanning error:', err); // log-injection-ok noble internal error
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  stopScanning(): Promise<void> {
    this.scanRequested = false;
    return new Promise((resolve) => {
      try {
        noble.stopScanning(() => resolve());
      } catch {
        resolve();
      }
    });
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
    try {
      this.scanRequested = false;
      noble.stopScanning();
    } catch {
      /* ignore */
    }
    try {
      noble.removeAllListeners('stateChange');
      noble.removeAllListeners('discover');
    } catch {
      /* ignore */
    }
    this.removeAllListeners();
    // Release the native BLEManager and its CBqueue dispatch queue (macOS only).
    // noble._bindings.stop() → CFRelease(BLEManager) → CBCentralManager + dispatch queue released.
    try {
      noble._bindings.stop();
    } catch {
      /* ignore */
    }
  }

  async connect(sessionId: NobleSessionId, peripheralId: string): Promise<void> {
    if (this.connectInProgressSessions.has(sessionId)) {
      throw new Error(`BLE connect already in progress for session ${sessionId}`);
    }
    this.connectInProgressSessions.add(sessionId);
    const session = this.getSession(sessionId);
    let peripheral: any = null;
    let connected = false;
    console.debug(
      `[BLE:${sessionId}] connect start — peripheralId=${peripheralId} adapterReady=${this.adapterReady} scanRequested=${this.scanRequested}`,
    );
    try {
      if (!this.adapterReady) {
        throw new Error('Bluetooth adapter is not powered on');
      }
      await this.stopScanning();
      await this.disconnect(sessionId);
      // Re-open a fresh session (disconnect sets closing=true; reset it for the new connection).
      session.closing = false;

      peripheral = this.knownPeripherals.get(peripheralId);
      if (!peripheral) {
        throw new Error(
          `BLE peripheral not found: ${peripheralId}. Scan for devices before connecting.`,
        );
      }

      const onDisconnected = () => {
        if (session.fromRadioChar && session.fromRadioDataHandler) {
          try {
            session.fromRadioChar.off('data', session.fromRadioDataHandler);
          } catch {
            /* ignore */
          }
        }
        if (session.fromNumChar && session.fromNumDataHandler) {
          try {
            session.fromNumChar.off('data', session.fromNumDataHandler);
          } catch {
            /* ignore */
          }
        }
        this.clearSessionState(session);
        this.emit('disconnected', { sessionId });
      };
      peripheral.once('disconnect', onDisconnected);
      session.connectedPeripheralDisconnectHandler = onDisconnected;

      await withTimeout(peripheral.connectAsync(), 15000, 'BLE connectAsync');
      connected = true;

      const { characteristics } = await withTimeout<{
        characteristics: any[];
      }>(
        peripheral.discoverSomeServicesAndCharacteristicsAsync(
          [SERVICE_UUID],
          [TORADIO_UUID, FROMRADIO_UUID, FROMNUM_UUID],
        ),
        15000,
        'BLE characteristic discovery',
      );
      for (const char of characteristics) {
        const uuid = normalizeUuid(char.uuid);
        if (uuid === TORADIO_UUID) session.toRadioChar = char;
        else if (uuid === FROMRADIO_UUID) session.fromRadioChar = char;
        else if (uuid === FROMNUM_UUID) session.fromNumChar = char;
      }
      console.debug(
        `[BLE:${sessionId}] discovered chars — toRadio=${Boolean(session.toRadioChar)} fromRadio=${Boolean(session.fromRadioChar)} fromNum=${Boolean(session.fromNumChar)} toRadioProps=${JSON.stringify(session.toRadioChar?.properties)} fromRadioProps=${JSON.stringify(session.fromRadioChar?.properties)} fromNumProps=${JSON.stringify(session.fromNumChar?.properties)}`,
      );

      // FROMNUM is optional for notification-based flow; require only TX/RX characteristics.
      if (!session.toRadioChar || !session.fromRadioChar) {
        throw new Error('Failed to find required Meshtastic BLE toRadio/fromRadio characteristics');
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
      if (session.fromRadioChar && session.fromRadioDataHandler) {
        try {
          session.fromRadioChar.off('data', session.fromRadioDataHandler);
        } catch {
          /* ignore */
        }
      }
      if (session.fromNumChar && session.fromNumDataHandler) {
        try {
          session.fromNumChar.off('data', session.fromNumDataHandler);
        } catch {
          /* ignore */
        }
      }
      if (peripheral && session.connectedPeripheralDisconnectHandler) {
        try {
          peripheral.removeListener('disconnect', session.connectedPeripheralDisconnectHandler);
        } catch {
          /* ignore */
        }
      }
      this.clearSessionState(session);
      if (connected) {
        await peripheral.disconnectAsync().catch(() => {});
      }
      throw err;
    } finally {
      this.connectInProgressSessions.delete(sessionId);
    }
  }

  async writeToRadio(sessionId: NobleSessionId, data: Buffer): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session.toRadioChar)
      throw new Error(`Not connected to a BLE device for session ${sessionId}`);
    console.debug(`[BLE:${sessionId}] writeToRadio: ${data.length} bytes`);
    await session.toRadioChar.writeAsync(data, false);
    console.debug(
      `[BLE:${sessionId}] writeToRadio done — scheduling post-write read pump in 100ms`,
    );
    // Give the device ~100ms to prepare its response, then kick the read pump.
    // fromNum notify is the primary trigger; this is a safety net for devices that are slow to notify.
    setTimeout(() => this.requestFromRadioReadPump(sessionId), 100);
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
          await peripheral.disconnectAsync();
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
