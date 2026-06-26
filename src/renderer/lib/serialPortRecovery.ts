import { withTimeout } from '../../shared/withTimeout';
import {
  getPortSignature,
  LAST_SERIAL_PORT_KEY,
  LAST_SERIAL_PORT_SIGNATURE_KEY,
  loadLastSerialPortId,
  loadLastSerialPortSignature,
  signaturesEqual,
} from './serialPortSignature';

/** Match Meshtastic initial connect timeout in connection.ts */
export const SERIAL_OPEN_TIMEOUT_MS = 15_000;

/** Shared serial silence thresholds (Meshtastic + MeshCore watchdog). */
export const SERIAL_STALE_THRESHOLD_MS = 120_000;
export const SERIAL_DEAD_THRESHOLD_MS = 180_000;
export const SERIAL_WATCHDOG_INTERVAL_MS = 15_000;

export function withSerialTransportTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return withTimeout(promise, SERIAL_OPEN_TIMEOUT_MS, label);
}

export async function openSerialPortWithTimeout(
  port: SerialPort,
  baudRate: number,
  label = 'Serial port open',
): Promise<void> {
  await withTimeout(port.open({ baudRate }), SERIAL_OPEN_TIMEOUT_MS, label);
}

export function isSerialPortForgetSupported(port?: SerialPort | null): boolean {
  if (!port) return false;
  return typeof (port as SerialPort & { forget?: () => Promise<void> }).forget === 'function';
}

/** Revoke Web Serial permission for a stale port; best-effort when API is absent. */
export async function forgetGrantedSerialPortBestEffort(port: SerialPort | null): Promise<void> {
  if (!port) return;
  const portWithForget = port as SerialPort & { forget?: () => Promise<void> };
  if (typeof portWithForget.forget !== 'function') {
    console.debug('[serialPortRecovery] SerialPort.forget not supported — skipping');
    return;
  }
  try {
    await portWithForget.forget();
    console.debug('[serialPortRecovery] forgot serial port permission');
  } catch (e) {
    console.warn(
      `[serialPortRecovery] forget failed ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function escalateSerialReconnectExhaustion(
  port: SerialPort | null | undefined,
): Promise<void> {
  await forgetGrantedSerialPortBestEffort(port ?? null);
  clearPersistedSerialPortIdentity();
}

export function clearPersistedSerialPortIdentity(): void {
  try {
    localStorage.removeItem(LAST_SERIAL_PORT_KEY);
    localStorage.removeItem(LAST_SERIAL_PORT_SIGNATURE_KEY);
  } catch {
    // catch-no-log-ok localStorage unavailable
  }
}

export function serialPortMatchesPersistedIdentity(port: SerialPort): boolean {
  const portId = (port as SerialPort & { portId?: string }).portId;
  const lastPortId = loadLastSerialPortId();
  if (lastPortId && portId && portId === lastPortId) return true;
  const lastSignature = loadLastSerialPortSignature();
  if (lastSignature && signaturesEqual(lastSignature, getPortSignature(port))) return true;
  return false;
}

export type SerialServiceDisconnectHandler = (port: SerialPort) => void;

/**
 * Listen for any granted port disconnect at the Serial service level.
 * Returns cleanup; no-op when Web Serial is unavailable.
 */
export function attachSerialServiceDisconnectListener(
  onPortDisconnected: SerialServiceDisconnectHandler,
): () => void {
  const serial = navigator.serial;
  if (!serial || typeof serial.addEventListener !== 'function') {
    return () => {};
  }

  const handler = (event: Event) => {
    const target = event.target;
    if (!target || typeof (target as SerialPort).close !== 'function') return;
    onPortDisconnected(target as SerialPort);
  };

  serial.addEventListener('disconnect', handler);
  return () => {
    serial.removeEventListener('disconnect', handler);
  };
}
