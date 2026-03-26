import type { Types } from '@meshtastic/core';

import type { NobleBleSessionId } from './types';

export class WebBluetoothManager {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private toRadioCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private fromRadioCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private fromRadioNotifyHandler: ((event: Event) => void) | null = null;
  private _fromDeviceController: ReadableStreamDefaultController<Types.DeviceOutput> | null = null;
  private fromRadioUnsub: (() => void) | null = null;
  private connectStartedAtMs: number | null = null;
  private sessionId: NobleBleSessionId;

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
    const isMeshcore = this.sessionId === 'meshcore';
    const serviceUuid = isMeshcore
      ? '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
      : '6ba1b218-15a8-461f-9fa8-5dcae273eafd';

    console.debug(`[WebBluetooth:${this.sessionId}] requestDevice for service ${serviceUuid}`);

    if (!navigator.bluetooth) {
      throw new Error(
        'Web Bluetooth is not available. Ensure you are using a Chromium-based browser with Web Bluetooth enabled.',
      );
    }

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] },
          { services: ['6ba1b218-15a8-461f-9fa8-5dcae273eafd'] },
        ],
      });
    } catch (err) {
      const domErr = err as DOMException;
      console.error(
        `[WebBluetooth:${this.sessionId}] requestDevice EXCEPTION:`,
        err,
        'name:',
        domErr?.name,
        'message:',
        domErr?.message,
      );
      throw err;
    }

    console.debug(
      `[WebBluetooth:${this.sessionId}] device selected: ${this.device.id} (${this.device.name ?? 'unnamed'})`,
    );

    this.connectStartedAtMs = Date.now();

    this.device.addEventListener('gattserverdisconnected', () => {
      console.debug(`[WebBluetooth:${this.sessionId}] device disconnected`);
      this.cleanup();
    });

    return this.device;
  }

  async connect(): Promise<void> {
    if (!this.device) {
      throw new Error('No device selected. Call requestDevice() first.');
    }

    this.server = await this.device.gatt!.connect();
    console.debug(`[WebBluetooth:${this.sessionId}] gatt connected`);

    const isMeshcore = this.sessionId === 'meshcore';
    const serviceUuid = isMeshcore
      ? '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
      : '6ba1b218-15a8-461f-9fa8-5dcae273eafd';

    const service = await this.server.getPrimaryService(serviceUuid);

    if (isMeshcore) {
      const rxUuid = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
      const txUuid = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

      this.toRadioCharacteristic = await service.getCharacteristic(rxUuid);
      this.fromRadioCharacteristic = await service.getCharacteristic(txUuid);
    } else {
      const toRadioUuid = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
      const fromRadioUuid = '2c55e69e-4993-11ed-b878-0242ac120002';

      this.toRadioCharacteristic = await service.getCharacteristic(toRadioUuid);
      this.fromRadioCharacteristic = await service.getCharacteristic(fromRadioUuid);
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

    this.fromRadioCharacteristic.addEventListener(
      'characteristicvaluechanged',
      this.fromRadioNotifyHandler,
    );
    await this.fromRadioCharacteristic.startNotifications();

    console.debug(`[WebBluetooth:${this.sessionId}] notifications started`);
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
    } catch {
      // catch-no-log-ok ignore errors during cleanup
    }

    try {
      if (this.device.gatt?.connected) {
        this.device.gatt.disconnect();
      }
    } catch {
      // catch-no-log-ok ignore errors during disconnect
    }

    this.cleanup();
  }

  private cleanup(): void {
    if (this.fromRadioUnsub) {
      this.fromRadioUnsub();
      this.fromRadioUnsub = null;
    }
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
