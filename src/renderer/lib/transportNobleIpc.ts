import type { Types } from '@meshtastic/core';

import type { NobleBleSessionId } from './types';

/**
 * IPC-backed Transport implementation for @stoprocent/noble BLE.
 * The actual BLE operations run in the Electron main process via NobleBleManager.
 * This transport bridges the renderer-side MeshDevice to the main-process noble instance
 * using Electron IPC.
 *
 * Usage:
 *   const transport = new TransportNobleIpc();
 *   await window.electronAPI.connectNobleBle(peripheralId); // main process connects
 *   const device = new MeshDevice(transport as any);
 *   device.configure();
 */
export class TransportNobleIpc implements Types.Transport {
  private readonly sessionId: NobleBleSessionId;
  private _fromDeviceController: ReadableStreamDefaultController<Types.DeviceOutput> | null = null;
  private _fromRadioUnsub: (() => void) | null = null;

  public readonly toDevice: WritableStream<Uint8Array>;
  public readonly fromDevice: ReadableStream<Types.DeviceOutput>;

  constructor(sessionId: NobleBleSessionId) {
    this.sessionId = sessionId;
    // fromDevice: ReadableStream fed by noble-ble-from-radio IPC events from main process
    this.fromDevice = new ReadableStream<Types.DeviceOutput>({
      start: (controller) => {
        this._fromDeviceController = controller;
        this._fromRadioUnsub = window.electronAPI.onNobleBleFromRadio(({ sessionId, bytes }) => {
          if (sessionId !== this.sessionId) return;
          if (this._fromDeviceController) {
            this._fromDeviceController.enqueue({ type: 'packet', data: bytes });
          }
        });
      },
      cancel: () => {
        if (this._fromRadioUnsub) {
          this._fromRadioUnsub();
          this._fromRadioUnsub = null;
        }
        this._fromDeviceController = null;
      },
    });

    // toDevice: WritableStream that forwards bytes to noble via IPC
    this.toDevice = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        await window.electronAPI.nobleBleToRadio(this.sessionId, chunk);
      },
      close: () => {
        if (this._fromRadioUnsub) {
          this._fromRadioUnsub();
          this._fromRadioUnsub = null;
        }
      },
    });
  }

  async disconnect(): Promise<void> {
    await window.electronAPI.disconnectNobleBle(this.sessionId);
    if (this._fromRadioUnsub) {
      this._fromRadioUnsub();
      this._fromRadioUnsub = null;
    }
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
