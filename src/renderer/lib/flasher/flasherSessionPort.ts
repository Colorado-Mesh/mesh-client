import { LAST_SERIAL_PORT_KEY } from '@/renderer/lib/serialPortSignature';

const FLASHER_LAST_PORT_KEY = 'mesh-client:flasherLastSerialPortId';
const POST_FLASH_BOOT_SETTLE_MS = 5000;

let sessionPortId: string | null = null;
/** Web Serial handle from the last flash picker / requestPort (object identity, not portId). */
let sessionSerialPort: SerialPort | null = null;
let lastFlashCompletedAt: number | null = null;

export function setFlasherSessionPortId(portId: string): void {
  sessionPortId = portId;
  try {
    localStorage.setItem(FLASHER_LAST_PORT_KEY, portId);
    localStorage.setItem(LAST_SERIAL_PORT_KEY, portId);
  } catch {
    // catch-no-log-ok localStorage quota or private mode — session still holds portId
  }
}

export function getFlasherSessionPortId(): string | null {
  if (sessionPortId) {
    return sessionPortId;
  }
  try {
    return localStorage.getItem(FLASHER_LAST_PORT_KEY);
  } catch {
    // catch-no-log-ok localStorage read failure
    return null;
  }
}

export function setFlasherSessionSerialPort(port: SerialPort | null): void {
  sessionSerialPort = port;
}

export function getFlasherSessionSerialPort(): SerialPort | null {
  return sessionSerialPort;
}

export function hasFlasherSessionPort(): boolean {
  return sessionSerialPort != null || sessionPortId != null;
}

export function clearFlasherFlashSession(): void {
  sessionSerialPort = null;
  lastFlashCompletedAt = null;
}

export function markFlasherFlashCompleted(): void {
  lastFlashCompletedAt = Date.now();
}

/** Milliseconds to wait so RNode firmware can boot after an ESP32 flash. */
export function getPostFlashBootWaitMs(): number {
  if (lastFlashCompletedAt == null) {
    return 0;
  }
  const elapsed = Date.now() - lastFlashCompletedAt;
  if (elapsed >= POST_FLASH_BOOT_SETTLE_MS) {
    return 0;
  }
  return POST_FLASH_BOOT_SETTLE_MS - elapsed;
}
