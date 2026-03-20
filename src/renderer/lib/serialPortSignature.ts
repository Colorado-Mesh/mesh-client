/**
 * Persist Web Serial port identity for gesture-free reconnect when `portId` is
 * missing or unstable (Electron/Chromium). Shared by MeshCore and Meshtastic.
 */

export const LAST_SERIAL_PORT_KEY = 'mesh-client:lastSerialPort';
export const LAST_SERIAL_PORT_SIGNATURE_KEY = 'mesh-client:lastSerialPortSignature';

export interface SerialPortSignature {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: string;
}

export function getPortSignature(port: SerialPort): SerialPortSignature {
  const info = port.getInfo?.() ?? {};
  return {
    usbVendorId: info.usbVendorId,
    usbProductId: info.usbProductId,
    bluetoothServiceClassId: info.bluetoothServiceClassId,
  };
}

export function signaturesEqual(a: SerialPortSignature | null, b: SerialPortSignature): boolean {
  if (!a) return false;
  return (
    a.usbVendorId === b.usbVendorId &&
    a.usbProductId === b.usbProductId &&
    (a.bluetoothServiceClassId ?? null) === (b.bluetoothServiceClassId ?? null)
  );
}

export function loadLastSerialPortSignature(): SerialPortSignature | null {
  try {
    const raw = localStorage.getItem(LAST_SERIAL_PORT_SIGNATURE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SerialPortSignature;
  } catch {
    return null;
  }
}

export function saveLastSerialPortSignature(sig: SerialPortSignature): void {
  try {
    localStorage.setItem(LAST_SERIAL_PORT_SIGNATURE_KEY, JSON.stringify(sig));
  } catch {
    /* ignore */
  }
}

/**
 * Pick a granted SerialPort for auto-reconnect: match `portId` first, then
 * saved USB/Bluetooth signature. Does not fall back to an arbitrary port.
 */
export function selectGrantedSerialPort(
  ports: SerialPort[],
  lastPortId?: string | null,
): SerialPort {
  if (ports.length === 0) {
    throw new Error('No previously granted serial ports found');
  }
  let port: SerialPort | undefined;
  if (lastPortId) {
    port = (ports as (SerialPort & { portId?: string })[]).find((p) => p.portId === lastPortId);
  }
  const lastSignature = loadLastSerialPortSignature();
  if (!port && lastSignature) {
    port = ports.find((candidate) => signaturesEqual(lastSignature, getPortSignature(candidate)));
  }
  if (!port) {
    throw new Error('No matching previously used serial device found');
  }
  return port;
}

export function persistSerialPortIdentity(port: SerialPort): void {
  saveLastSerialPortSignature(getPortSignature(port));
  const portId = (port as SerialPort & { portId?: string }).portId;
  if (portId) {
    try {
      localStorage.setItem(LAST_SERIAL_PORT_KEY, portId);
    } catch {
      /* ignore */
    }
  }
}
