import type { Types } from '@meshtastic/core';

/**
 * IPC-backed Transport implementation for Meshtastic HTTP.
 * The HTTP requests are proxied through the Electron main process to bypass CSP.
 *
 * Usage:
 *   const transport = new TransportHttpIpc(host, useTls);
 *   await transport.connect(); // establishes connection via IPC
 *   const device = new MeshDevice(transport as any);
 *   device.configure();
 */
export class TransportHttpIpc implements Types.Transport {
  private readonly host: string;
  private readonly tls: boolean;
  private _fromDeviceController: ReadableStreamDefaultController<Types.DeviceOutput> | null = null;
  private _fromRadioUnsub: (() => void) | null = null;

  public readonly toDevice: WritableStream<Uint8Array>;
  public readonly fromDevice: ReadableStream<Types.DeviceOutput>;

  constructor(host: string, tls: boolean) {
    this.host = host;
    this.tls = tls;
    this.fromDevice = new ReadableStream<Types.DeviceOutput>({
      start: (controller) => {
        this._fromDeviceController = controller;
        this._fromRadioUnsub = window.electronAPI.http.onData((bytes) => {
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

    this.toDevice = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        await window.electronAPI.http.write(Array.from(chunk));
      },
      close: () => {
        if (this._fromRadioUnsub) {
          this._fromRadioUnsub();
          this._fromRadioUnsub = null;
        }
      },
    });
  }

  async connect(): Promise<void> {
    await window.electronAPI.http.preflight(this.host, this.tls);
    await window.electronAPI.http.connect(this.host, this.tls);
  }

  async disconnect(): Promise<void> {
    await window.electronAPI.http.disconnect();
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
