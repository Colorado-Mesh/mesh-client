import { setRendererStorageItem } from '@/renderer/lib/rendererStorage';
/**
 * Persist Web Serial port identity for gesture-free reconnect when `portId` is
 * missing or unstable (Electron/Chromium). Shared by MeshCore and Meshtastic.
 */

export const LAST_SERIAL_PORT_KEY = 'mesh-client:lastSerialPort';
export const LAST_SERIAL_PORT_SIGNATURE_KEY = 'mesh-client:lastSerialPortSignature';

/** Thrown when no granted port matches saved portId / USB signature. */
export const SERIAL_NO_MATCH_ERROR = 'No matching previously used serial device found';

/**
 * Thrown when two or more granted ports share the saved USB signature (e.g. Dual
 * CP2105 Standard + Enhanced COM). Callers should open the serial picker instead
 * of silently binding the first match.
 */
export const SERIAL_MULTIPLE_MATCH_ERROR = 'Multiple matching serial devices found';

export interface SerialPortSignature {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: string;
  /** USB serial number when Chromium exposes it (helps disambiguate devices). */
  serialNumber?: string;
}

export interface SerialPortFingerprint {
  portId: string | null;
  usbVendorId: number | null;
  usbProductId: number | null;
  serialNumber: string | null;
}

export function getPortSignature(port: SerialPort): SerialPortSignature {
  const info = port.getInfo();
  const serialNumber = info.serialNumber?.trim();
  return {
    usbVendorId: info.usbVendorId,
    usbProductId: info.usbProductId,
    bluetoothServiceClassId: info.bluetoothServiceClassId,
    ...(serialNumber ? { serialNumber } : {}),
  };
}

export function signaturesEqual(a: SerialPortSignature | null, b: SerialPortSignature): boolean {
  if (!a) return false;
  if (
    a.usbVendorId !== b.usbVendorId ||
    a.usbProductId !== b.usbProductId ||
    (a.bluetoothServiceClassId ?? null) !== (b.bluetoothServiceClassId ?? null)
  ) {
    return false;
  }
  // Only compare serialNumber when both sides expose it — Chromium may omit it on
  // one interface or after a driver reload; VID/PID(+BT) still match in that case.
  const aSn = a.serialNumber?.trim() || null;
  const bSn = b.serialNumber?.trim() || null;
  if (aSn && bSn && aSn !== bSn) return false;
  return true;
}

export function loadLastSerialPortId(): string | null {
  try {
    return localStorage.getItem(LAST_SERIAL_PORT_KEY);
  } catch (e: unknown) {
    console.debug('[renderer/lib/serialPortSignature] catch:', e);

    return null;
  }
}

export function loadLastSerialPortSignature(): SerialPortSignature | null {
  try {
    const raw = localStorage.getItem(LAST_SERIAL_PORT_SIGNATURE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SerialPortSignature;
  } catch (e: unknown) {
    console.debug('[renderer/lib/serialPortSignature] catch:', e);

    return null;
  }
}

export function saveLastSerialPortSignature(sig: SerialPortSignature): void {
  try {
    setRendererStorageItem(LAST_SERIAL_PORT_SIGNATURE_KEY, JSON.stringify(sig));
  } catch (e: unknown) {
    console.debug('[renderer/lib/serialPortSignature] catch:', e);
  }
}

export function fingerprintGrantedSerialPort(port: SerialPort): SerialPortFingerprint {
  const info = port.getInfo();
  const portId = (port as SerialPort & { portId?: string }).portId;
  const serialNumber = info.serialNumber?.trim();
  return {
    portId: portId ?? null,
    usbVendorId: info.usbVendorId ?? null,
    usbProductId: info.usbProductId ?? null,
    serialNumber: serialNumber || null,
  };
}

/** Debug triage when signature match fails or is ambiguous (Dual CP2105, etc.). */
export function logGrantedSerialPortMatchFailure(
  reason: 'no-match' | 'ambiguous',
  ports: SerialPort[],
  lastPortId?: string | null,
  lastSignature?: SerialPortSignature | null,
): void {
  try {
    const detail = {
      reason,
      lastPortId: lastPortId ?? null,
      lastSignature: lastSignature ?? null,
      granted: ports.map(fingerprintGrantedSerialPort),
    };
    console.debug(`[serialPortSignature] selectGrantedSerialPort ${JSON.stringify(detail)}`);
  } catch (e: unknown) {
    console.debug('[renderer/lib/serialPortSignature] catch:', e);
  }
}

export function isAmbiguousSerialPortMatchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(SERIAL_MULTIPLE_MATCH_ERROR);
}

/**
 * Pick a granted SerialPort for auto-reconnect: match `portId` first, then
 * saved USB/Bluetooth signature. Does not fall back to an arbitrary port.
 * When 2+ ports share the saved signature, throws {@link SERIAL_MULTIPLE_MATCH_ERROR}
 * so callers open the picker instead of binding the wrong Dual CP2105 interface.
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
    const matches = ports.filter((candidate) =>
      signaturesEqual(lastSignature, getPortSignature(candidate)),
    );
    if (matches.length > 1) {
      logGrantedSerialPortMatchFailure('ambiguous', ports, lastPortId, lastSignature);
      throw new Error(SERIAL_MULTIPLE_MATCH_ERROR);
    }
    port = matches[0];
  }
  if (!port) {
    logGrantedSerialPortMatchFailure('no-match', ports, lastPortId, lastSignature);
    throw new Error(SERIAL_NO_MATCH_ERROR);
  }
  return port;
}

export function persistSerialPortIdentity(port: SerialPort): void {
  saveLastSerialPortSignature(getPortSignature(port));
  const portId = (port as SerialPort & { portId?: string }).portId;
  if (portId) {
    try {
      setRendererStorageItem(LAST_SERIAL_PORT_KEY, portId);
    } catch (e: unknown) {
      console.debug('[renderer/lib/serialPortSignature] catch:', e);
    }
  }
}
