import { Connection } from '@liamcottle/meshcore.js';
import type { Types } from '@meshtastic/core';

import { withTimeout } from '../../shared/withTimeout';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- TransportWebBluetoothIpc is used as a value (new) in connect()
import { TransportWebBluetoothIpc } from './transportWebBluetoothIpc';

// BlueZ is slower than macOS CBCentralManager - use generous timeouts
const WEB_BLUETOOTH_REQUEST_DEVICE_TIMEOUT_MS = 60_000;
const WEB_BLUETOOTH_CONNECT_TIMEOUT_MS = 60_000;
const WEB_BLUETOOTH_HANDSHAKE_TIMEOUT_MS = 20_000;

export class MeshcoreWebBluetoothConnection extends Connection {
  private readonly transport: TransportWebBluetoothIpc;
  private _fromDeviceReader: ReadableStreamDefaultReader<Types.DeviceOutput> | null = null;

  constructor(transport: TransportWebBluetoothIpc) {
    super();
    this.transport = transport;
  }

  async sendToRadioFrame(data: Uint8Array): Promise<void> {
    this.emit('tx', data);
    const writer = this.transport.toDevice.getWriter();
    try {
      await writer.ready;
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  async close(): Promise<void> {
    if (this._fromDeviceReader) {
      await this._fromDeviceReader.cancel().catch(() => {});
      this._fromDeviceReader = null;
    }
    await this.transport.disconnect();
  }

  async connect(reuseDeviceId?: string): Promise<void> {
    // Wrap all connection steps in timeouts to prevent hanging on unresponsive devices
    if (reuseDeviceId) {
      await withTimeout(
        this.transport.requestGrantedDevice(reuseDeviceId),
        WEB_BLUETOOTH_REQUEST_DEVICE_TIMEOUT_MS,
        'Web Bluetooth reuse granted device',
      );
    } else {
      await withTimeout(
        this.transport.requestDevice(),
        WEB_BLUETOOTH_REQUEST_DEVICE_TIMEOUT_MS,
        'Web Bluetooth request device',
      );
    }

    await withTimeout(
      this.transport.connect(),
      WEB_BLUETOOTH_CONNECT_TIMEOUT_MS,
      'Web Bluetooth transport connect',
    );

    this._fromDeviceReader = this.transport.fromDevice.getReader();
    void this._readLoop();

    await withTimeout(
      this.onConnected(),
      WEB_BLUETOOTH_HANDSHAKE_TIMEOUT_MS,
      'MeshCore BLE protocol handshake',
    );
  }

  private async _readLoop(): Promise<void> {
    try {
      while (true) {
        const { done, value } = await this._fromDeviceReader!.read();
        if (done) {
          break;
        }
        if (value.type === 'packet') {
          this.onFrameReceived(value.data);
        }
      }
    } catch (err) {
      console.warn('[MeshcoreWebBluetoothConnection] _readLoop error:', err);
    } finally {
      try {
        this._fromDeviceReader?.releaseLock();
      } catch {
        // catch-no-log-ok releaseLock after stream teardown
      }
    }
  }
}
