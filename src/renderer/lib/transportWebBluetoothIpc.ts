import type { Types } from '@meshtastic/core';

import type { NobleBleSessionId } from './types';
import { WebBluetoothManager } from './webbluetooth-ble-manager';

const webBluetoothManagerBySession = new Map<NobleBleSessionId, WebBluetoothManager>();

export class TransportWebBluetoothIpc implements Types.Transport {
  private readonly sessionId: NobleBleSessionId;
  private _fromDeviceController: ReadableStreamDefaultController<Types.DeviceOutput> | null = null;
  private _bleManager: WebBluetoothManager | null = null;
  private _lastGrantedDeviceId: string | null = null;

  public readonly toDevice: WritableStream<Uint8Array>;
  public readonly fromDevice: ReadableStream<Types.DeviceOutput>;

  constructor(sessionId: NobleBleSessionId) {
    this.sessionId = sessionId;

    this.fromDevice = new ReadableStream<Types.DeviceOutput>({
      start: (controller) => {
        this._fromDeviceController = controller;
      },
      cancel: () => {
        if (this._bleManager) {
          this._bleManager.disconnect().catch(console.error);
          this._bleManager = null;
          webBluetoothManagerBySession.delete(this.sessionId);
        }
        this._fromDeviceController = null;
      },
    });

    this.toDevice = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (this._bleManager) {
          await this._bleManager.writeToRadio(chunk);
        }
      },
      close: () => {
        if (this._bleManager) {
          this._bleManager.disconnect().catch(console.error);
          this._bleManager = null;
          webBluetoothManagerBySession.delete(this.sessionId);
        }
      },
    });
  }

  async requestDevice(): Promise<{ deviceId: string; deviceName: string }> {
    this._bleManager = new WebBluetoothManager(this.sessionId);
    webBluetoothManagerBySession.set(this.sessionId, this._bleManager);
    const device = await this._bleManager.requestDevice();
    this._lastGrantedDeviceId = device.id;
    return {
      deviceId: device.id,
      deviceName: device.name ?? 'Unknown Device',
    };
  }

  /** Reuse a granted device after a timeout retry (no `requestDevice()` / user gesture). */
  async requestGrantedDevice(deviceId: string): Promise<{ deviceId: string; deviceName: string }> {
    this._bleManager = new WebBluetoothManager(this.sessionId);
    webBluetoothManagerBySession.set(this.sessionId, this._bleManager);
    const device = await this._bleManager.acquireGrantedDeviceById(deviceId);
    this._lastGrantedDeviceId = device.id;
    return {
      deviceId: device.id,
      deviceName: device.name ?? 'Unknown Device',
    };
  }

  static getManager(sessionId: NobleBleSessionId): WebBluetoothManager | undefined {
    return webBluetoothManagerBySession.get(sessionId);
  }

  pushConfig(): Promise<void> {
    return Promise.resolve();
  }

  async connect(): Promise<void> {
    if (!this._bleManager) {
      throw new Error('No device selected. Call requestDevice() first.');
    }
    await this._bleManager.connect();

    // Pipe the BLE manager's fromDevice stream to our fromDevice stream
    const reader = this._bleManager.fromDevice.getReader();
    void this._readLoop(reader);
  }

  private async _readLoop(reader: ReadableStreamDefaultReader<Types.DeviceOutput>): Promise<void> {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!this._fromDeviceController) {
          break;
        }
        this._fromDeviceController.enqueue(value);
      }
    } catch (err) {
      console.error('[TransportWebBluetoothIpc] _readLoop: error:', err);
      // Error the controller so stream consumers are notified and don't hang
      this._fromDeviceController?.error(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // Release the reader to prevent memory leaks
      try {
        reader.releaseLock();
      } catch {
        // catch-no-log-ok releaseLock after stream teardown
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this._bleManager) {
      await this._bleManager.disconnect();
      this._bleManager = null;
    }
  }

  isConnected(): boolean {
    return this._bleManager?.isConnected() ?? false;
  }

  getDeviceInfo(): { deviceId: string; deviceName: string } | null {
    return this._bleManager?.getDeviceInfo() ?? null;
  }

  getLastGrantedDeviceId(): string | null {
    return this._lastGrantedDeviceId;
  }
}
