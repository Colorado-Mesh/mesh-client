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

  async connect(): Promise<void> {
    console.debug('[MeshcoreWebBluetoothConnection] connect: starting');

    // Wrap all connection steps in timeouts to prevent hanging on unresponsive devices
    await withTimeout(
      this.transport.requestDevice(),
      WEB_BLUETOOTH_REQUEST_DEVICE_TIMEOUT_MS,
      'Web Bluetooth request device',
    );
    console.debug('[MeshcoreWebBluetoothConnection] connect: device selected');

    await withTimeout(
      this.transport.connect(),
      WEB_BLUETOOTH_CONNECT_TIMEOUT_MS,
      'Web Bluetooth transport connect',
    );
    console.debug('[MeshcoreWebBluetoothConnection] connect: transport connected');

    this._fromDeviceReader = this.transport.fromDevice.getReader();
    console.debug('[MeshcoreWebBluetoothConnection] connect: starting read loop');
    void this._readLoop();

    console.debug('[MeshcoreWebBluetoothConnection] connect: calling onConnected()');
    await withTimeout(
      this.onConnected(),
      WEB_BLUETOOTH_HANDSHAKE_TIMEOUT_MS,
      'MeshCore BLE protocol handshake',
    );
    console.debug('[MeshcoreWebBluetoothConnection] connect: onConnected() completed');
  }

  private async _readLoop(): Promise<void> {
    console.debug('[MeshcoreWebBluetoothConnection] _readLoop: started');
    try {
      while (true) {
        const { done, value } = await this._fromDeviceReader!.read();
        console.debug('[MeshcoreWebBluetoothConnection] _readLoop: read result', {
          done,
          hasValue: !!value,
        });
        if (done) {
          console.debug('[MeshcoreWebBluetoothConnection] _readLoop: done=true, exiting');
          break;
        }
        if (value.type === 'packet') {
          console.debug(
            '[MeshcoreWebBluetoothConnection] _readLoop: received packet,',
            value.data.length,
            'bytes',
          );
          this.onFrameReceived(value.data);
        } else {
          console.debug(
            '[MeshcoreWebBluetoothConnection] _readLoop: received non-packet:',
            value.type,
          );
        }
      }
    } catch (err) {
      console.debug('[MeshcoreWebBluetoothConnection] _readLoop: caught error:', err);
    }
    console.debug('[MeshcoreWebBluetoothConnection] _readLoop: exited');
  }
}
