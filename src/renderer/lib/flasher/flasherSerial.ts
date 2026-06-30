import { closeSerialPortIfOpen } from '@/renderer/lib/connection';
import { loadLastSerialPortId, selectGrantedSerialPort } from '@/renderer/lib/serialPortSignature';

import { sleepMillis } from './binaryUtils';
import {
  getFlasherSessionPortId,
  getFlasherSessionSerialPort,
  getPostFlashBootWaitMs,
} from './flasherSessionPort';
import { RNode } from './rnode';

const PORT_SELECTION_TIMEOUT_MS = 115_000;
const RNODE_DETECT_RETRY_MS = 1500;
const RNODE_DETECT_MAX_ATTEMPTS = 8;
const RNODE_DETECT_TIMEOUT_MS = 2000;
const RNODE_READ_LOOP_SETTLE_MS = 250;
const RNODE_BOOT_DRAIN_MS = 2000;

export function assertWebSerialAvailable(): void {
  if (!navigator.serial?.requestPort) {
    throw new Error('WEB_SERIAL_UNSUPPORTED');
  }
}

function isRequestPortNotSelectedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Failed to execute') && message.includes('requestPort');
}

/** Close only granted ports that still have open Web Serial streams (meshchat closes rnode only). */
async function closeOpenGrantedSerialPorts(): Promise<void> {
  if (!navigator.serial?.getPorts) {
    return;
  }
  const granted = await navigator.serial.getPorts();
  for (const port of granted) {
    if (port.readable || port.writable) {
      await closeSerialPortIfOpen(port);
    }
  }
}

async function pickGrantedFlasherPort(sessionOnly = false): Promise<SerialPort> {
  if (!navigator.serial?.getPorts) {
    throw new Error('FLASHER_NO_SERIAL_PORTS');
  }
  const granted = await navigator.serial.getPorts();
  if (granted.length === 0) {
    throw new Error('FLASHER_NO_SERIAL_PORTS');
  }

  const sessionPort = getFlasherSessionSerialPort();
  if (sessionPort && granted.includes(sessionPort)) {
    await closeSerialPortIfOpen(sessionPort);
    return sessionPort;
  }

  const preferredPortId = getFlasherSessionPortId();
  if (preferredPortId) {
    const port = (granted as (SerialPort & { portId?: string })[]).find(
      (candidate) => candidate.portId === preferredPortId,
    );
    if (port) {
      await closeSerialPortIfOpen(port);
      return port;
    }
  }

  if (sessionOnly) {
    throw new Error('FLASHER_NO_SESSION_PORT');
  }

  const fallbackPortId = loadLastSerialPortId();
  const port = selectGrantedSerialPort(granted, fallbackPortId);
  await closeSerialPortIfOpen(port);
  return port;
}

export interface RequestFlasherSerialPortOptions {
  /** Reuse the port from a prior flash/provision step (same tab session). */
  preferSessionReuse?: boolean;
  /** Electron picker: auto-select this port id (meshchat-style fresh requestPort). */
  autoSelectPortId?: string | null;
}

/**
 * Meshchat parity for first connect: close open handles, call requestPort(), show picker.
 * When Chromium sends an empty port list (already-granted USB devices), fall back to
 * the matching granted port instead of showing an empty picker.
 */
export async function requestFlasherSerialPort(
  requestPort?: () => Promise<SerialPort>,
  options?: RequestFlasherSerialPortOptions,
): Promise<SerialPort> {
  assertWebSerialAvailable();

  if (options?.preferSessionReuse) {
    try {
      return await pickGrantedFlasherPort(true);
    } catch {
      // catch-no-log-ok session reuse failed — fall through to picker
    }
  }

  await closeOpenGrantedSerialPorts();

  const request = requestPort ?? (() => navigator.serial!.requestPort({ filters: [] }));
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    const autoSelectPortId = options?.autoSelectPortId ?? null;
    const cleanup = window.electronAPI.onSerialPortsDiscovered((ports) => {
      if (
        autoSelectPortId &&
        ports.some((entry) => entry.portId === autoSelectPortId) &&
        !settled
      ) {
        window.electronAPI.selectSerialPort(autoSelectPortId);
        return;
      }
      if (ports.length > 0) {
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      window.electronAPI.selectSerialPort('');
      void pickGrantedFlasherPort().then(resolve).catch(reject);
    });

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      fn();
    };

    request()
      .then((port) => {
        finish(() => {
          resolve(port);
        });
      })
      .catch((err: unknown) => {
        finish(() => {
          if (isRequestPortNotSelectedError(err)) {
            if (Date.now() - startedAt >= PORT_SELECTION_TIMEOUT_MS) {
              reject(new Error('FLASHER_SERIAL_PORT_SELECTION_TIMEOUT'));
              return;
            }
            reject(new Error('FLASHER_SERIAL_PORT_SELECTION_CANCELLED'));
            return;
          }
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });
  });
}

export async function connectRNode(
  port: SerialPort,
  options?: { detectAttempts?: number },
): Promise<RNode> {
  const detectAttempts = options?.detectAttempts ?? RNODE_DETECT_MAX_ATTEMPTS;

  const bootWaitMs = getPostFlashBootWaitMs();
  if (bootWaitMs > 0) {
    await sleepMillis(bootWaitMs);
  }

  await closeSerialPortIfOpen(port);

  for (let attempt = 1; attempt <= detectAttempts; attempt++) {
    const bootDrainMs = attempt === 1 ? RNODE_BOOT_DRAIN_MS : 0;
    await closeSerialPortIfOpen(port);
    const rnode = await RNode.fromSerialPort(port, { bootDrainMs });
    await sleepMillis(RNODE_READ_LOOP_SETTLE_MS);
    const isRNode = await rnode.detect(RNODE_DETECT_TIMEOUT_MS);
    if (isRNode) {
      return rnode;
    }
    await rnode.close();
    if (attempt < detectAttempts) {
      await sleepMillis(RNODE_DETECT_RETRY_MS);
    }
  }

  throw new Error('NOT_RNODE');
}

export async function requestFlasherRNodePort(
  requestPort?: () => Promise<SerialPort>,
): Promise<SerialPort> {
  const sessionPort = getFlasherSessionSerialPort();
  if (sessionPort) {
    await closeSerialPortIfOpen(sessionPort);
  }
  // Meshchat parity: user picks the port on each RNode action (askForRNode → requestPort).
  return requestFlasherSerialPort(requestPort);
}

export async function safeCloseSerialPort(port: SerialPort | null | undefined): Promise<void> {
  if (!port) return;
  try {
    await closeSerialPortIfOpen(port);
  } catch {
    // catch-no-log-ok: port may already be closed after flash
  }
}
