import type { Types } from '@meshtastic/core';

import { BLE_TO_RADIO_PAYLOAD_CAP } from '@/shared/bleAttWriteLimit';

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
/** Align with `noble-ble-manager.ts` — drain burst cap for Meshtastic fromRadio read pump. */
const BLE_READ_PUMP_MAX_ITERATIONS = 512;

/** Web Bluetooth experimental API not in all TS DOM libs (descriptor discovery). */
type BluetoothRemoteGATTCharacteristicWithDescriptors = BluetoothRemoteGATTCharacteristic & {
  getDescriptors(): Promise<{ uuid: string }[]>;
};

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

/**
 * Chromium exposes `maximumWriteValueLength` on some builds; Web Bluetooth has no standard negotiated-MTU API.
 * @see https://github.com/WebBluetoothCG/web-bluetooth/issues/383
 */
export function probeWebBluetoothToRadioChunkLimitBytes(
  characteristic: BluetoothRemoteGATTCharacteristic,
): number | null {
  const c = characteristic as BluetoothRemoteGATTCharacteristic & {
    maximumWriteValueLength?: number;
  };
  if (typeof c.maximumWriteValueLength === 'number' && c.maximumWriteValueLength > 0) {
    return Math.min(c.maximumWriteValueLength, BLE_TO_RADIO_PAYLOAD_CAP);
  }
  return null;
}

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
  private sessionId: NobleBleSessionId;
  private fromRadioDescriptorUuids: string[] = [];
  /** When true, `fromRadio` uses GATT readValue pump (Linux/BlueZ may lack CCCD for notify on 2c55…). */
  private meshtasticFromRadioReadPump = false;
  /** When set, `writeToRadio` splits payloads (Chromium `maximumWriteValueLength`); null = single writeValue. */
  private toRadioChunkLimitBytes: number | null = null;
  private _pendingDevicePromise?: Promise<BluetoothDevice>;
  private _resolvePendingDevice?: (device: BluetoothDevice) => void;
  private _rejectPendingDevice?: (reason?: unknown) => void;

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
    this._pendingDevicePromise = new Promise<BluetoothDevice>((resolve, reject) => {
      this._resolvePendingDevice = resolve;
      this._rejectPendingDevice = reject;
    });

    console.debug(`[WebBluetooth:${this.sessionId}] waiting for device selection via picker...`);

    // Trigger Chromium's Web Bluetooth chooser flow.
    // On Linux, main intercepts select-bluetooth-device and forwards devices to our custom picker.
    // Choosing a device there resolves this requestDevice promise.
    void navigator.bluetooth
      .requestDevice({
        filters: [{ services: [serviceUuid] }],
        optionalServices: [serviceUuid],
      })
      .then((device) => {
        this.resolveDevice(device);
      })
      .catch((err: unknown) => {
        if (this._rejectPendingDevice) {
          this._rejectPendingDevice(err);
        }
        this._pendingDevicePromise = undefined;
        this._resolvePendingDevice = undefined;
        this._rejectPendingDevice = undefined;
      });

    // Set up listener for when device is resolved from the chooser
    this._pendingDevicePromise
      .then((device) => {
        console.debug(
          `[WebBluetooth:${this.sessionId}] device selected: ${device.id} (${device.name ?? 'unnamed'})`,
        );
        device.addEventListener('gattserverdisconnected', () => {
          console.debug(`[WebBluetooth:${this.sessionId}] device disconnected`);
          this.cleanup();
        });
      })
      .catch((err: unknown) => {
        console.error(`[WebBluetooth:${this.sessionId}] requestDevice failed:`, err);
        this._pendingDevicePromise = undefined;
        this._resolvePendingDevice = undefined;
        this._rejectPendingDevice = undefined;
      });

    return this._pendingDevicePromise;
  }

  resolveDevice(device: BluetoothDevice): void {
    if (this._resolvePendingDevice) {
      this.device = device;
      this._resolvePendingDevice(device);
      this._pendingDevicePromise = undefined;
      this._resolvePendingDevice = undefined;
      this._rejectPendingDevice = undefined;
    }
  }

  /**
   * Reconnect a previously granted Web Bluetooth device without `requestDevice()` (no user gesture).
   * Used after a retryable timeout when Chromium still grants access to the same device id.
   */
  async acquireGrantedDeviceById(deviceId: string): Promise<BluetoothDevice> {
    if (this.device?.id === deviceId) {
      return this.device;
    }

    if (!navigator.bluetooth) {
      throw new Error(
        'Web Bluetooth is not available. Ensure you are using a Chromium-based browser with Web Bluetooth enabled.',
      );
    }

    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((d) => d.id === deviceId);
    if (!device) {
      throw new Error(
        'Previously selected Bluetooth device is no longer available. Tap Connect again to choose the device.',
      );
    }

    console.debug(
      `[WebBluetooth:${this.sessionId}] reusing granted device: ${device.id} (${device.name ?? 'unnamed'})`,
    );
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      console.debug(`[WebBluetooth:${this.sessionId}] device disconnected`);
      this.cleanup();
    });
    return device;
  }

  private enqueueFromRadioBytes(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    if (this._fromDeviceController) {
      this._fromDeviceController.enqueue({ type: 'packet', data: bytes });
    }
  }

  private async drainMeshtasticFromRadioReads(): Promise<void> {
    if (!this.meshtasticFromRadioReadPump || !this.fromRadioCharacteristic) return;
    const ch = this.fromRadioCharacteristic;
    for (let i = 0; i < BLE_READ_PUMP_MAX_ITERATIONS; i++) {
      if (!this.device?.gatt?.connected) return;
      let dataView: DataView;
      try {
        dataView = await withGattTimeout(
          ch.readValue(),
          GATT_DISCOVERY_TIMEOUT_MS,
          'GATT fromRadio readValue',
        );
      } catch {
        // catch-no-log-ok read pump end — expected when characteristic is drained or stack errors
        break;
      }
      if (!dataView.byteLength) break;
      const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
      this.enqueueFromRadioBytes(bytes);
      await Promise.resolve();
    }
  }

  async connect(): Promise<void> {
    if (!this.device) {
      throw new Error('No device selected. Call requestDevice() first.');
    }
    const gatt = this.device.gatt;
    if (!gatt) {
      throw new Error('Selected device does not expose a GATT server.');
    }

    const isMeshcore = this.sessionId === 'meshcore';
    const serviceUuid = isMeshcore
      ? '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
      : '6ba1b218-15a8-461f-9fa8-5dcae273eafd';

    // Wrap all GATT operations to classify errors for better user guidance
    try {
      this.server = await withGattTimeout(gatt.connect(), GATT_CONNECT_TIMEOUT_MS, 'GATT connect');
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

    let service: BluetoothRemoteGATTService;
    try {
      service = await withGattTimeout(
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
      this.toRadioChunkLimitBytes = probeWebBluetoothToRadioChunkLimitBytes(
        this.toRadioCharacteristic,
      );
      if (this.toRadioChunkLimitBytes != null) {
        console.debug(
          `[WebBluetooth:${this.sessionId}] toRadio chunk limit=${this.toRadioChunkLimitBytes} (maximumWriteValueLength)`,
        );
      }
      try {
        const descriptors = await withGattTimeout(
          (
            this.fromRadioCharacteristic as BluetoothRemoteGATTCharacteristicWithDescriptors
          ).getDescriptors(),
          GATT_DISCOVERY_TIMEOUT_MS,
          'GATT descriptor discovery (fromRadio)',
        );
        this.fromRadioDescriptorUuids = descriptors.map((d) => d.uuid.toLowerCase());
      } catch {
        // catch-no-log-ok BlueZ may omit descriptor enumeration; notify path uses empty list
        this.fromRadioDescriptorUuids = [];
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
        const slicedBytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        this.enqueueFromRadioBytes(slicedBytes);
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
      const isDescriptorMissingNotSupported =
        domErr?.name === 'NotSupportedError' && this.fromRadioDescriptorUuids.length === 0;
      if (this.sessionId === 'meshtastic' && isDescriptorMissingNotSupported && service) {
        // `ed9da18c-…` is **fromNum**, not fromRadio — see `noble-ble-manager.ts` (FROMNUM_UUID).
        // Do not subscribe there for the Meshtastic protobuf stream. When Linux exposes no CCCD on
        // canonical fromRadio (`2c55…`), fall back to GATT read pump like Noble does.
        const primary = this.fromRadioCharacteristic;
        const notifyHandler = this.fromRadioNotifyHandler;
        if (primary?.properties.read) {
          if (notifyHandler) {
            primary.removeEventListener('characteristicvaluechanged', notifyHandler);
          }
          this.meshtasticFromRadioReadPump = true;
          console.debug(
            `[WebBluetooth:${this.sessionId}] fromRadio: notify unavailable (no CCCD); using read pump`,
          );
          void this.drainMeshtasticFromRadioReads();
          return;
        }
      }
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
    // GATT disconnect only; do not call BluetoothDevice.forget() — that drops OS pairing/grants.

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
    this.meshtasticFromRadioReadPump = false;
    this.toRadioChunkLimitBytes = null;
  }

  async writeToRadio(data: Uint8Array): Promise<void> {
    if (!this.toRadioCharacteristic) {
      throw new Error('Not connected');
    }

    const ch = this.toRadioCharacteristic;
    const limit = this.toRadioChunkLimitBytes;
    if (limit == null || data.length <= limit) {
      await ch.writeValue(data);
    } else {
      for (let offset = 0; offset < data.length; offset += limit) {
        const end = Math.min(offset + limit, data.length);
        await ch.writeValue(data.subarray(offset, end));
      }
    }
    if (this.sessionId === 'meshtastic' && this.meshtasticFromRadioReadPump) {
      await this.drainMeshtasticFromRadioReads();
    }
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
