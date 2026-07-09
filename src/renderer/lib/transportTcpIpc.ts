import type { Types } from '@meshtastic/core';
import { Utils } from '@meshtastic/core';

/**
 * IPC-backed Transport implementation for Meshtastic's native TCP streaming API (port 4403).
 * The raw socket lives in the Electron main process; this class only carries framed bytes
 * across IPC and reuses @meshtastic/core's own framing parser/encoder.
 *
 * Usage:
 *   const transport = new TransportTcpIpc(host, port);
 *   await transport.connect();
 *   const device = new MeshDevice(transport);
 *   device.configure();
 */
export class TransportTcpIpc implements Types.Transport {
  private readonly host: string;
  private readonly port: number;
  private _fromRadioUnsub: (() => void) | null = null;
  private _disconnectUnsub: (() => void) | null = null;
  private readonly _framerWriter: WritableStreamDefaultWriter<Uint8Array>;

  public readonly toDevice: WritableStream<Uint8Array>;
  public readonly fromDevice: ReadableStream<Types.DeviceOutput>;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;

    // Utils.fromDeviceStream() is a factory (safe to call fresh per instance), unlike
    // Utils.toDeviceStream which is a shared singleton TransformStream unsafe to reuse
    // across reconnects (see patches/@jsr__meshtastic__transport-web-serial@0.2.5.patch).
    const framer = Utils.fromDeviceStream();
    this.fromDevice = framer.readable;
    this._framerWriter = framer.writable.getWriter();

    this._fromRadioUnsub = window.electronAPI.meshtastic.tcp.onData((bytes) => {
      void this._framerWriter.write(bytes).catch(() => {
        // catch-no-log-ok framer writer closed during teardown race
      });
    });
    this._disconnectUnsub = window.electronAPI.meshtastic.tcp.onDisconnected(() => {
      void this._framerWriter.close().catch(() => {
        // catch-no-log-ok framer writer already closed
      });
    });

    this.toDevice = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        await window.electronAPI.meshtastic.tcp.write(Array.from(frameToDevice(chunk)));
      },
      close: () => {
        this._teardownListeners();
      },
    });
  }

  async connect(): Promise<void> {
    await window.electronAPI.meshtastic.tcp.connect(this.host, this.port);
  }

  async disconnect(): Promise<void> {
    await window.electronAPI.meshtastic.tcp.disconnect();
    this._teardownListeners();
    await this._framerWriter.close().catch(() => {
      // catch-no-log-ok framer writer already closed
    });
  }

  private _teardownListeners(): void {
    this._fromRadioUnsub?.();
    this._fromRadioUnsub = null;
    this._disconnectUnsub?.();
    this._disconnectUnsub = null;
  }
}

/**
 * Local per-instance outbound framer mirroring @meshtastic/core's Utils.toDeviceStream
 * header logic (0x94 0xc3 magic + big-endian 16-bit length), without reusing that shared
 * singleton TransformStream across instances/reconnects.
 */
function frameToDevice(chunk: Uint8Array): Uint8Array {
  const len = chunk.length;
  const header = new Uint8Array([0x94, 0xc3, (len >> 8) & 0xff, len & 0xff]);
  const out = new Uint8Array(header.length + chunk.length);
  out.set(header, 0);
  out.set(chunk, header.length);
  return out;
}
