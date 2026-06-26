/**
 * Minimal Web Serial API declarations for TypeScript.
 * See https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
 */
interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
  getInfo(): {
    serialNumber?: string;
    usbVendorId?: number;
    usbProductId?: number;
    bluetoothServiceClassId?: string;
  };
  addEventListener(
    type: 'connect' | 'disconnect',
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: 'connect' | 'disconnect',
    listener: (event: Event) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

interface Serial extends EventTarget {
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: { filters?: unknown[] }): Promise<SerialPort>;
  addEventListener(
    type: 'connect' | 'disconnect',
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: 'connect' | 'disconnect',
    listener: (event: Event) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

interface Navigator {
  serial?: Serial;
}
