/**
 * Minimal Web Serial API declarations for TypeScript.
 * See https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
 */
interface SerialPort {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { serialNumber?: string; usbVendorId?: number; usbProductId?: number };
}

interface Serial {
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: { filters?: unknown[] }): Promise<SerialPort>;
}

interface Navigator {
  serial?: Serial;
}
