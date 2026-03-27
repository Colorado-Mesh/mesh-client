import type { Types } from '@meshtastic/core';

import type { NobleBleSessionId } from './types';

// Error types for Web Bluetooth GATT operations on Linux
export type WebBluetoothErrorType =
  | 'connection_failed'
  | 'service_not_found'
  | 'characteristic_not_found'
  | 'notification_setup_failed'
  | 'pairing_failed';

// BlueZ error patterns that indicate pairing/authentication issues on Linux
const BLUEZ_PAIRING_ERROR_RE =
  /le-connection-abort-by-local|auth failed|connection rejected|pin failed|authentication failed/i;

// Timeout constants for GATT operations (BlueZ is slower than macOS)
const GATT_CONNECT_TIMEOUT_MS = 30_000;
const GATT_DISCOVERY_TIMEOUT_MS = 30_000;
const GATT_NOTIFICATION_TIMEOUT_MS = 20_000;

/**
 * Wrap a Promise with a timeout that rejects if it doesn't complete within the specified time.
 * Unlike withTimeout, this doesn't require a label and wraps timeout errors with better context.
 */
function withGattTimeout<T>(promise: Promise<T>, ms: number, context: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${context} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([
    promise.finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }),
    timeoutPromise,
  ]);
}

// Chrome DOMException names that often indicate pairing issues on Linux
const CHROME_PAIRING_ERROR_NAMES = ['SecurityError', 'NetworkError'];

export function isWebBluetoothPairingError(err: unknown): boolean {
  if (err instanceof DOMException) {
    if (CHROME_PAIRING_ERROR_NAMES.includes(err.name)) {
      return true;
    }
    if (BLUEZ_PAIRING_ERROR_RE.test(err.message)) {
      return true;
    }
  }
  if (err instanceof Error) {
    if (err.message.includes('GATT Error: Not supported')) {
      return true;
    }
    if (BLUEZ_PAIRING_ERROR_RE.test(err.message)) {
      return true;
    }
  }
  return false;
}

export class WebBluetoothManager {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private toRadioCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private fromRadioCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private fromRadioNotifyHandler: ((event: Event) => void) | null = null;
  private _fromDeviceController: ReadableStreamDefaultController<Types.DeviceOutput> | null = null;
  private connectStartedAtMs: number | null = null;
  private sessionId: NobleBleSessionId;
  private _pendingDevicePromise?: Promise<BluetoothDevice>;
  private _resolvePendingDevice?: (device: BluetoothDevice) => void;

  public readonly toDevice: WritableStream<Uint8Array>;
  public readonly fromDevice: ReadableStream<Types.DeviceOutput>;

  constructor(sessionId: NobleBleSessionId) {
    this.sessionId = sessionId;

    this.fromDevice = new ReadableStream<Types.DeviceOutput>({
      start: (controller) => {
        this._fromDeviceController = controller;
      },
      cancel: () => {
        this.cleanup();
      },
    });

    this.toDevice = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        console.debug('[WebBluetoothManager] toRadio bytes', chunk.length);
        await this.writeToRadio(chunk);
      },
      close: () => {
        this.cleanup();
      },
    });
  }

  async requestDevice(): Promise<BluetoothDevice> {
    // If device already selected (e.g., resolved via picker), return it
    if (this.device) {
      return this.device;
    }

    // If a pending request exists, return that promise (allows deferred resolution)
    if (this._pendingDevicePromise) {
      return this._pendingDevicePromise;
    }

    const isMeshcore = this.sessionId === 'meshcore';
    const serviceUuid = isMeshcore
      ? '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
      : '6ba1b218-15a8-461f-9fa8-5dcae273eafd';

    console.debug(`[WebBluetooth:${this.sessionId}] requestDevice for service ${serviceUuid}`);

    if (!navigator.bluetooth) {
      console.error('[WebBluetooth] navigator.bluetooth is UNDEFINED!');
      throw new Error(
        'Web Bluetooth is not available. Ensure you are using a Chromium-based browser with Web Bluetooth enabled. Check chrome://flags for "Experimental Web Platform Features".',
      );
    }

    console.debug('[WebBluetooth] navigator.bluetooth available, checking getAvailability...');
    try {
      const availability = await navigator.bluetooth.getAvailability();
      console.debug('[WebBluetooth] getAvailability:', availability);
      if (!availability) {
        throw new Error(
          'No Bluetooth adapters available. Make sure Bluetooth is enabled on your system.',
        );
      }
    } catch (err) {
      console.debug('[WebBluetooth] getAvailability failed (expected on some platforms):', err);
    }

    // Create deferred promise for custom picker flow on Linux
    // The promise will be resolved when resolveDevice() is called from handleSelectBleDevice
    this._pendingDevicePromise = new Promise<BluetoothDevice>((resolve) => {
      this._resolvePendingDevice = resolve;
    });

    console.debug(`[WebBluetooth:${this.sessionId}] waiting for device selection via picker...`);

    // Set up listener for when device is resolved from the picker
    // The actual device resolution happens via resolveDevice() called from ConnectionPanel
    this._pendingDevicePromise
      .then((device) => {
        console.debug(
          `[WebBluetooth:${this.sessionId}] device selected: ${device.id} (${device.name ?? 'unnamed'})`,
        );
        this.connectStartedAtMs = Date.now();
        device.addEventListener('gattserverdisconnected', () => {
          console.debug(`[WebBluetooth:${this.sessionId}] device disconnected`);
          this.cleanup();
        });
      })
      .catch((err: unknown) => {
        console.error(`[WebBluetooth:${this.sessionId}] requestDevice failed:`, err);
        this._pendingDevicePromise = undefined;
        this._resolvePendingDevice = undefined;
      });

    return this._pendingDevicePromise;
  }

  resolveDevice(device: BluetoothDevice): void {
    if (this._resolvePendingDevice) {
      this.device = device;
      this._resolvePendingDevice(device);
      this._pendingDevicePromise = undefined;
      this._resolvePendingDevice = undefined;
    }
  }

  async connect(): Promise<void> {
    if (!this.device) {
      throw new Error('No device selected. Call requestDevice() first.');
    }

    const isMeshcore = this.sessionId === 'meshcore';
    const serviceUuid = isMeshcore
      ? '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
      : '6ba1b218-15a8-461f-9fa8-5dcae273eafd';

    // Wrap all GATT operations to classify errors for better user guidance
    try {
      this.server = await withGattTimeout(
        this.device.gatt!.connect(),
        GATT_CONNECT_TIMEOUT_MS,
        'GATT connect',
      );
      console.debug(`[WebBluetooth:${this.sessionId}] gatt connected`);
    } catch (err) {
      const domErr = err as DOMException;
      const isPairing = isWebBluetoothPairingError(err);
      console.debug(
        `[WebBluetooth:${this.sessionId}] gatt.connect() failed:`,
        domErr?.name,
        domErr?.message,
        isPairing ? '(pairing-related)' : '',
      );
      console.debug('[WebBluetooth] raw error:', err);
      // Wrap the error with classification info for the UI layer
      const error = new Error(
        `Bluetooth connection failed${isPairing ? ' (pairing issue)' : ''}: ${domErr?.message ?? String(err)}`,
      ) as Error & { isPairingRelated?: boolean };
      error.isPairingRelated = isPairing;
      throw error;
    }

    try {
      const service = await withGattTimeout(
        this.server.getPrimaryService(serviceUuid),
        GATT_DISCOVERY_TIMEOUT_MS,
        'GATT service discovery',
      );

      if (isMeshcore) {
        const rxUuid = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
        const txUuid = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

        this.toRadioCharacteristic = await withGattTimeout(
          service.getCharacteristic(rxUuid),
          GATT_DISCOVERY_TIMEOUT_MS,
          'GATT characteristic discovery (RX)',
        );
        this.fromRadioCharacteristic = await withGattTimeout(
          service.getCharacteristic(txUuid),
          GATT_DISCOVERY_TIMEOUT_MS,
          'GATT characteristic discovery (TX)',
        );
      } else {
        const toRadioUuid = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
        const fromRadioUuid = '2c55e69e-4993-11ed-b878-0242ac120002';

        this.toRadioCharacteristic = await withGattTimeout(
          service.getCharacteristic(toRadioUuid),
          GATT_DISCOVERY_TIMEOUT_MS,
          'GATT characteristic discovery (toRadio)',
        );
        this.fromRadioCharacteristic = await withGattTimeout(
          service.getCharacteristic(fromRadioUuid),
          GATT_DISCOVERY_TIMEOUT_MS,
          'GATT characteristic discovery (fromRadio)',
        );
      }
    } catch (err) {
      const domErr = err as DOMException;
      const isPairing = isWebBluetoothPairingError(err);
      console.debug(
        `[WebBluetooth:${this.sessionId}] GATT service/characteristic discovery failed:`,
        domErr?.name,
        domErr?.message,
        isPairing ? '(pairing-related)' : '',
      );
      console.debug('[WebBluetooth] GATT discovery raw error:', err);
      // "GATT Error: Not supported" typically means device requires pairing before GATT operations
      const error = new Error(
        `GATT Error: Not supported. The device may require pairing. ${domErr?.message ?? String(err)}`,
      ) as Error & { isPairingRelated?: boolean };
      error.isPairingRelated = true; // This error type is almost always pairing-related
      throw error;
    }

    this.fromRadioNotifyHandler = (event: Event) => {
      const target = event.target as unknown as BluetoothRemoteGATTCharacteristic | null;
      if (!target) return;
      const value = target.value;
      if (value && value.byteLength > 0) {
        const bytes = new Uint8Array(value.buffer);
        console.debug(`[WebBluetooth:${this.sessionId}] fromRadio notify: ${bytes.length} bytes`);
        if (this._fromDeviceController) {
          this._fromDeviceController.enqueue({ type: 'packet', data: bytes });
        }
      }
    };

    try {
      this.fromRadioCharacteristic.addEventListener(
        'characteristicvaluechanged',
        this.fromRadioNotifyHandler,
      );
      await withGattTimeout(
        this.fromRadioCharacteristic.startNotifications(),
        GATT_NOTIFICATION_TIMEOUT_MS,
        'GATT start notifications',
      );
      console.debug(`[WebBluetooth:${this.sessionId}] notifications started`);
    } catch (err) {
      const domErr = err as DOMException;
      const isPairing = isWebBluetoothPairingError(err);
      console.debug(
        `[WebBluetooth:${this.sessionId}] startNotifications failed:`,
        domErr?.name,
        domErr?.message,
        isPairing ? '(pairing-related)' : '',
      );
      console.debug('[WebBluetooth] startNotifications raw error:', err);
      const error = new Error(
        `Failed to start Bluetooth notifications${isPairing ? ' (pairing issue)' : ''}: ${domErr?.message ?? String(err)}`,
      ) as Error & { isPairingRelated?: boolean };
      error.isPairingRelated = isPairing;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.device) return;

    try {
      if (this.fromRadioCharacteristic && this.fromRadioNotifyHandler) {
        this.fromRadioCharacteristic.removeEventListener(
          'characteristicvaluechanged',
          this.fromRadioNotifyHandler,
        );
        await this.fromRadioCharacteristic.stopNotifications();
      }
    } catch (err) {
      console.debug('[WebBluetoothManager] stopNotifications error during cleanup:', err);
    }

    try {
      if (this.device.gatt?.connected) {
        this.device.gatt.disconnect();
      }
    } catch (err) {
      console.debug('[WebBluetoothManager] disconnect error during cleanup:', err);
    }

    this.cleanup();
  }

  private cleanup(): void {
    this._fromDeviceController = null;
    this.device = null;
    this.server = null;
    this.toRadioCharacteristic = null;
    this.fromRadioCharacteristic = null;
    this.fromRadioNotifyHandler = null;
    this.connectStartedAtMs = null;
  }

  async writeToRadio(data: Uint8Array): Promise<void> {
    if (!this.toRadioCharacteristic) {
      throw new Error('Not connected');
    }

    const timeSinceConnect =
      this.connectStartedAtMs != null ? Date.now() - this.connectStartedAtMs : 'unknown';
    const hexDump = Array.from(data.subarray(0, Math.min(data.length, 20)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    console.info(
      `[WebBluetooth:${this.sessionId}] writeToRadio: ${data.length} bytes timeSinceConnect=${timeSinceConnect}ms data=[${hexDump}${data.length > 20 ? '...' : ''}]`,
    );

    await this.toRadioCharacteristic.writeValue(data);
    console.info(
      `[WebBluetooth:${this.sessionId}] writeToRadio done bytes=${data.length} timeSinceConnect=${timeSinceConnect}ms`,
    );
  }

  isConnected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  getDeviceInfo(): { deviceId: string; deviceName: string } | null {
    if (!this.device) return null;
    return {
      deviceId: this.device.id,
      deviceName: this.device.name ?? 'Unknown Device',
    };
  }
}
