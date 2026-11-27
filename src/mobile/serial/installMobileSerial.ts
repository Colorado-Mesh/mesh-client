/**
 * `navigator.serial` for the mobile app, backed by the native `MeshUsbSerial` plugin
 * (Android USB host + usb-serial-for-android drivers: CDC-ACM, CP210x, CH34x, FTDI, PL2303).
 *
 * The renderer's Meshtastic / MeshCore / MeshCom serial transports use the Web Serial API; this
 * polyfill gives them the same `SerialPort` surface (open/close, readable/writable streams,
 * getInfo, setSignals) so they run unmodified. iOS has no USB serial access for third-party
 * apps (OS-specific exception), so the polyfill is Android-only.
 */
import { getPlugin, listenPlugin } from '../bridge/nativePlugins';
import { showMessage } from '../bridge/uiOps';
import type { MeshUsbSerialPlugin, UsbSerialDevice } from '../native/contracts';

type UsbDevice = UsbSerialDevice;
type UsbSerialPlugin = MeshUsbSerialPlugin;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

const portsById = new Map<string, MobileSerialPort>();
const grantedDevices = new Set<string>();
let listenersReady: Promise<void> | null = null;

function plugin(): UsbSerialPlugin {
  return getPlugin('MeshUsbSerial') as unknown as UsbSerialPlugin;
}

function ensureListeners(serial: MobileSerial): Promise<void> {
  listenersReady ??= (async () => {
    await listenPlugin('MeshUsbSerial', 'data', (d) => {
      const m = d as { portId: string; dataB64: string };
      portsById.get(m.portId)?._onData(unb64(m.dataB64));
    });
    await listenPlugin('MeshUsbSerial', 'closed', (d) => {
      const m = d as { portId: string; error?: string };
      portsById.get(m.portId)?._onClosed(m.error);
    });
    await listenPlugin('MeshUsbSerial', 'attached', (d) => {
      serial._onAttach((d as { device: UsbDevice }).device);
    });
    await listenPlugin('MeshUsbSerial', 'detached', (d) => {
      serial._onDetach((d as { device: UsbDevice }).device);
    });
  })();
  return listenersReady;
}

class MobileSerialPort extends EventTarget {
  private portId: string | null = null;
  private reader: ReadableStreamDefaultController<Uint8Array> | null = null;
  private _readable: ReadableStream<Uint8Array> | null = null;
  private _writable: WritableStream<Uint8Array> | null = null;
  onconnect: ((ev: Event) => void) | null = null;
  ondisconnect: ((ev: Event) => void) | null = null;
  /** Stable id used by the renderer's serial port identity persistence. */
  readonly portIdKey: string;

  constructor(readonly device: UsbDevice) {
    super();
    this.portIdKey = device.deviceId;
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this._readable;
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this._writable;
  }

  readonly connected = true;

  getInfo(): { usbVendorId: number; usbProductId: number } {
    return { usbVendorId: this.device.vendorId, usbProductId: this.device.productId };
  }

  async open(opts: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
    bufferSize?: number;
  }): Promise<void> {
    if (this.portId) throw new DOMException('The port is already open.', 'InvalidStateError');
    const p = plugin();
    if (!grantedDevices.has(this.device.deviceId)) {
      const { granted } = await p.requestPermission({ deviceId: this.device.deviceId });
      if (!granted) throw new DOMException('USB permission denied.', 'SecurityError');
      grantedDevices.add(this.device.deviceId);
    }
    const { portId } = await p.open({
      deviceId: this.device.deviceId,
      baudRate: opts.baudRate,
      dataBits: opts.dataBits ?? 8,
      stopBits: opts.stopBits ?? 1,
      parity: (opts.parity ?? 'none') as 'none' | 'even' | 'odd',
    });
    this.portId = portId;
    portsById.set(portId, this);
    this._readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.reader = c;
      },
      cancel: () => {
        this.reader = null;
      },
    });
    this._writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (!this.portId) throw new DOMException('The port is closed.', 'InvalidStateError');
        await p.write({ portId: this.portId, dataB64: b64(chunk) });
      },
    });
  }

  async close(): Promise<void> {
    const id = this.portId;
    if (!id) return;
    this.portId = null;
    portsById.delete(id);
    try {
      this.reader?.close();
    } catch {
      // catch-no-log-ok stream already closed by its consumer
    }
    this.reader = null;
    this._readable = null;
    this._writable = null;
    await plugin().close({ portId: id });
  }

  async setSignals(s: {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
    break?: boolean;
  }): Promise<void> {
    if (!this.portId) throw new DOMException('The port is closed.', 'InvalidStateError');
    await plugin().setSignals({
      portId: this.portId,
      dtr: s.dataTerminalReady,
      rts: s.requestToSend,
      brk: s.break,
    });
  }

  async getSignals(): Promise<{
    dataCarrierDetect: boolean;
    clearToSend: boolean;
    ringIndicator: boolean;
    dataSetReady: boolean;
  }> {
    if (!this.portId) throw new DOMException('The port is closed.', 'InvalidStateError');
    const r = await plugin().getSignals({ portId: this.portId });
    return {
      dataCarrierDetect: r.dcd,
      clearToSend: r.cts,
      ringIndicator: r.ri,
      dataSetReady: r.dsr,
    };
  }

  async forget(): Promise<void> {
    await this.close();
    grantedDevices.delete(this.device.deviceId);
  }

  /** @internal */
  _onData(bytes: Uint8Array): void {
    this.reader?.enqueue(bytes);
  }

  /** @internal */
  _onClosed(error?: string): void {
    const id = this.portId;
    if (id) portsById.delete(id);
    this.portId = null;
    try {
      if (error) this.reader?.error(new DOMException(error, 'NetworkError'));
      else this.reader?.close();
    } catch {
      // catch-no-log-ok stream already closed by its consumer
    }
    this.reader = null;
  }
}

class MobileSerial extends EventTarget {
  private readonly known = new Map<string, MobileSerialPort>();
  onconnect: ((ev: Event) => void) | null = null;
  ondisconnect: ((ev: Event) => void) | null = null;

  private portFor(d: UsbDevice): MobileSerialPort {
    let p = this.known.get(d.deviceId);
    if (!p) {
      p = new MobileSerialPort(d);
      this.known.set(d.deviceId, p);
    }
    return p;
  }

  async getPorts(): Promise<MobileSerialPort[]> {
    await ensureListeners(this);
    const { devices } = await plugin().listDevices();
    return devices.filter((d) => grantedDevices.has(d.deviceId)).map((d) => this.portFor(d));
  }

  async requestPort(opts?: {
    filters?: { usbVendorId?: number; usbProductId?: number }[];
  }): Promise<MobileSerialPort> {
    await ensureListeners(this);
    const { devices } = await plugin().listDevices();
    const filters = opts?.filters ?? [];
    const matching = devices.filter(
      (d) =>
        filters.length === 0 ||
        filters.some(
          (f) =>
            (f.usbVendorId === undefined || f.usbVendorId === d.vendorId) &&
            (f.usbProductId === undefined || f.usbProductId === d.productId),
        ),
    );
    if (matching.length === 0) {
      throw new DOMException(
        'No USB serial device is connected. Connect the radio with a USB OTG cable.',
        'NotFoundError',
      );
    }
    let chosen = matching[0];
    if (matching.length > 1) {
      const labels = matching.map(
        (d) =>
          d.productName ||
          d.manufacturerName ||
          `USB ${d.vendorId.toString(16)}:${d.productId.toString(16)}`,
      );
      const { response } = await showMessage({
        title: 'Choose a radio',
        message: 'Choose the USB device to connect',
        buttons: [...labels, 'Cancel'],
        cancelId: labels.length,
      });
      if (response >= labels.length)
        throw new DOMException('No port selected by the user.', 'NotFoundError');
      chosen = matching[response];
    }
    const { granted } = await plugin().requestPermission({ deviceId: chosen.deviceId });
    if (!granted) throw new DOMException('USB permission denied.', 'SecurityError');
    grantedDevices.add(chosen.deviceId);
    return this.portFor(chosen);
  }

  /** @internal */
  _onAttach(d: UsbDevice): void {
    const ev = new Event('connect');
    Object.defineProperty(ev, 'target', { value: this.portFor(d) });
    this.dispatchEvent(ev);
    this.onconnect?.(ev);
  }

  /** @internal */
  _onDetach(d: UsbDevice): void {
    const p = this.known.get(d.deviceId);
    p?._onClosed('The device has been lost.');
    const ev = new Event('disconnect');
    if (p) Object.defineProperty(ev, 'target', { value: p });
    this.dispatchEvent(ev);
    this.ondisconnect?.(ev);
  }
}

/** Install the polyfill on Android (Web Serial is not available in Android WebView). */
export function installMobileSerial(platform: 'android' | 'ios' | 'web'): void {
  if (platform !== 'android') return;
  if ((navigator as Navigator & { serial?: unknown }).serial) return;
  Object.defineProperty(navigator, 'serial', { value: new MobileSerial(), configurable: true });
}
