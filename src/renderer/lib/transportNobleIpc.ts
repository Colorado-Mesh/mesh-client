import type { Types } from '@meshtastic/core';

import type { NobleBleSessionId } from './types';

/**
 * IPC-backed Transport implementation for @abandonware/noble BLE.
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
          // #region agent log
          fetch('http://127.0.0.1:7586/ingest/49af3064-4f08-4b78-bc65-b64d378f5d17', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'e199e9' },
            body: JSON.stringify({
              sessionId: 'e199e9',
              runId: 'run-1',
              hypothesisId: 'H1',
              location: 'transportNobleIpc.ts:fromRadio',
              message: 'renderer fromRadio received',
              data: { sessionId, size: bytes.length },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          console.debug('[TransportNobleIpc] fromRadio bytes', bytes.length);
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
        console.debug('[TransportNobleIpc] toRadio bytes', chunk.length);
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
        // Controller may already be closed if stream was cancelled
      }
      this._fromDeviceController = null;
    }
  }
}
