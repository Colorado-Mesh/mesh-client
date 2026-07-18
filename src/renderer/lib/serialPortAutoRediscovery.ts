import { MS_PER_SECOND } from '@/shared/timeConstants';

import { getPortSignature, type SerialPortSignature, signaturesEqual } from './serialPortSignature';

export const SERIAL_REDISCOVERY_TIMEOUT_MS = 60_000;
export const SERIAL_REDISCOVERY_POLL_MS = 5 * MS_PER_SECOND;

export interface StartSerialRediscoveryOptions {
  /** Signature captured before escalate clears persisted identity. */
  signature: SerialPortSignature | null;
  /** Optional Chromium portId captured before escalate. */
  portId?: string | null;
  onFound: (port: SerialPort) => void;
  /** Called when the poll window expires without a match (e.g. forget port). */
  onTimeout?: () => void;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * After serial reconnect exhaustion, poll granted Web Serial ports for a match
 * against a signature captured before escalate cleared localStorage.
 * Returns a cleanup function (cancel timer / stop polling). Manual cancel does
 * not invoke onTimeout.
 */
export function startSerialRediscovery(opts: StartSerialRediscoveryOptions): () => void {
  const {
    signature,
    portId = null,
    onFound,
    onTimeout,
    timeoutMs = SERIAL_REDISCOVERY_TIMEOUT_MS,
    pollIntervalMs = SERIAL_REDISCOVERY_POLL_MS,
  } = opts;

  if (!signature && !portId) {
    return () => {};
  }
  const serial = typeof navigator !== 'undefined' ? navigator.serial : undefined;
  if (!serial?.getPorts) {
    return () => {};
  }

  let cleaned = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (timeoutTimer != null) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  };

  const tryFind = async () => {
    if (cleaned) return;
    try {
      const ports = await serial.getPorts();
      // Re-check after await: cleanup may have run while getPorts was in flight
      // (manual connect / disconnect). Calling onFound after cancel can force a
      // reconnect to a stale port.
      if (cleaned) return;
      const match = ports.find((port) => {
        const id = (port as SerialPort & { portId?: string }).portId;
        if (portId && id && id === portId) return true;
        if (signature && signaturesEqual(signature, getPortSignature(port))) return true;
        return false;
      });
      if (match) {
        cleanup();
        onFound(match);
      }
    } catch (e) {
      console.debug(
        `[serialPortAutoRediscovery] getPorts failed ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  void tryFind();
  pollTimer = setInterval(() => {
    void tryFind();
  }, pollIntervalMs);
  timeoutTimer = setTimeout(() => {
    if (cleaned) return;
    cleanup();
    onTimeout?.();
  }, timeoutMs);

  return cleanup;
}

/** Capture identity for rediscovery before escalate clears localStorage. */
export function captureSerialIdentityForRediscovery(port: SerialPort | null | undefined): {
  signature: SerialPortSignature | null;
  portId: string | null;
} {
  if (!port) {
    return { signature: null, portId: null };
  }
  try {
    return {
      signature: getPortSignature(port),
      portId: (port as SerialPort & { portId?: string }).portId ?? null,
    };
  } catch {
    // catch-no-log-ok port may already be invalid during teardown
    return { signature: null, portId: null };
  }
}
