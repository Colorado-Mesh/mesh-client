/**
 * Windows in-app BLE pairing for LoRa radios (sidecar WinRT custom pairing).
 *
 * Windows Settings pairing fails for some MeshCore radios (Wio L1 Pro), and an
 * unpaired radio can wedge btleplug's connect inside WinRT. Like Chrome's Web
 * Bluetooth, mesh-client checks the bond first and pairs with a PIN typed in the
 * Connection panel.
 */

import { isBlePairingError } from './bleConnectErrors';

export type WindowsBlePairState = 'paired' | 'unpaired' | 'unknown';

/** Thrown when pairing fails; `code` mirrors the sidecar GATT error taxonomy. */
export class WindowsBlePairingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'WindowsBlePairingError';
    this.code = code;
  }
}

/** `unknown` (sidecar down, unsupported, WinRT error) means "just try connecting". */
export async function getWindowsBlePairState(peripheralId: string): Promise<WindowsBlePairState> {
  try {
    const result = await window.electronAPI.gattPairState(peripheralId);
    if (result.ok) return result.paired ? 'paired' : 'unpaired';
    console.debug(
      `[windowsBlePairing] pair state unavailable code=${result.code} error=${result.error}`,
    );
  } catch (err) {
    console.debug(
      '[windowsBlePairing] pair state threw ' + (err instanceof Error ? err.message : String(err)),
    );
  }
  return 'unknown';
}

export async function pairWindowsBle(peripheralId: string, pin: string): Promise<void> {
  const result = await window.electronAPI.gattPair(peripheralId, pin);
  if (!result.ok) throw new WindowsBlePairingError(result.code, result.error);
}

/** Remove the OS bond so pairing can be redone in-app. Already-unpaired is fine. */
export async function unpairWindowsBle(peripheralId: string): Promise<void> {
  const result = await window.electronAPI.gattUnpair(peripheralId);
  if (!result.ok) throw new WindowsBlePairingError(result.code, result.error);
}

export function isWindowsPinRejected(err: unknown): boolean {
  return err instanceof WindowsBlePairingError && err.code === 'authentication_failed';
}

/**
 * Connect failures that a fresh in-app pairing can fix: missing/stale bond, or a
 * WinRT call wedged on a half-paired radio ("Bluetooth stack unresponsive").
 */
export function shouldOfferWindowsRePair(err: unknown): boolean {
  if (isBlePairingError(err)) return true;
  let msg = '';
  if (typeof err === 'string') msg = err;
  else if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    msg = err.message;
  }
  return /Bluetooth stack unresponsive/i.test(msg);
}
