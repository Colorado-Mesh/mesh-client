import type { Types } from '@meshtastic/core';

import type { GattBleSessionId } from './types';

/**
 * Sidecar GATT Transport for Meshtastic MeshDevice.
 * BLE runs in reticulum-sidecar (btleplug); Electron main proxies via gatt:* IPC.
 */
export class TransportSidecarGatt implements Types.Transport {
  private readonly sessionId: GattBleSessionId;
  private _fromDeviceController: ReadableStreamDefaultController<Types.DeviceOutput> | null = null;
  private _fromRadioUnsub: (() => void) | null = null;

  public readonly toDevice: WritableStream<Uint8Array>;
  public readonly fromDevice: ReadableStream<Types.DeviceOutput>;

  constructor(sessionId: GattBleSessionId) {
    this.sessionId = sessionId;
    this.fromDevice = new ReadableStream<Types.DeviceOutput>({
      start: (controller) => {
        this._fromDeviceController = controller;
        this._fromRadioUnsub = window.electronAPI.onGattFromRadio(({ sessionId, bytes }) => {
          if (sessionId !== this.sessionId) return;
          if (this._fromDeviceController) {
            this._fromDeviceController.enqueue({ type: 'packet', data: bytes });
          }
        });
      },
      cancel: () => {
        this.unsubscribeFromRadio();
        this._fromDeviceController = null;
      },
    });

    this.toDevice = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        await window.electronAPI.gattToRadio(this.sessionId, chunk);
      },
      close: () => {
        this.unsubscribeFromRadio();
      },
      abort: () => {
        this.unsubscribeFromRadio();
      },
    });
  }

  private unsubscribeFromRadio(): void {
    if (this._fromRadioUnsub) {
      this._fromRadioUnsub();
      this._fromRadioUnsub = null;
    }
  }

  async disconnect(): Promise<void> {
    await window.electronAPI.disconnectGatt(this.sessionId);
    this.unsubscribeFromRadio();
    if (this._fromDeviceController) {
      try {
        this._fromDeviceController.close();
      } catch {
        // catch-no-log-ok ReadableStreamDefaultController already closed if stream was cancelled
      }
      this._fromDeviceController = null;
    }
  }
}
