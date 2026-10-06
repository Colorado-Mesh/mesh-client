/**
 * Windows in-app BLE pairing for LoRa radios (sidecar WinRT custom pairing).
 *
 * Windows Settings pairing fails for some MeshCore radios (Wio L1 Pro), and an
 * unpaired radio can wedge btleplug's connect inside WinRT. Like Chrome's Web
 * Bluetooth, mesh-client checks the bond first and pairs with a PIN typed in the
 * Connection panel.
 */

import type { TFunction } from 'i18next';

import { bleIdMatchKey } from '@/shared/normalizeBleMac';

import { gattBleErrorI18nKey, isBlePairingError } from './bleConnectErrors';

/** `blocked` means a timeout or WinRT error; connecting from there wedges btleplug. */
export type WindowsBlePairState = 'paired' | 'unpaired' | 'unknown' | 'blocked';

/** Thrown when pairing fails; `code` mirrors the sidecar GATT error taxonomy. */
export class WindowsBlePairingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'WindowsBlePairingError';
    this.code = code;
  }
}

/**
 * A pair-state timeout (HTTP budget or sidecar `connect_timeout`) or a WinRT
 * failure (`internal` messages from `windows_pairing`) must not fall through to connect.
 * Sidecar-down and `unsupported` stay `unknown`.
 */
export function isWindowsPairStateHardFailure(code: string, error: string): boolean {
  if (code === 'connect_timeout') return true;
  return code === 'internal' && /^windows\b/i.test(error.trim());
}

/** `unknown` (sidecar down, unsupported) may still connect. `blocked` must not. */
export async function getWindowsBlePairState(peripheralId: string): Promise<WindowsBlePairState> {
  try {
    const result = await window.electronAPI.gattPairState(peripheralId);
    if (result.ok) return result.paired ? 'paired' : 'unpaired';
    console.debug(
      `[windowsBlePairing] pair state unavailable code=${result.code} error=${result.error}`,
    );
    if (isWindowsPairStateHardFailure(result.code, result.error)) return 'blocked';
  } catch (err) {
    console.debug(
      '[windowsBlePairing] pair state threw ' + (err instanceof Error ? err.message : String(err)),
    );
  }
  return 'unknown';
}

/** Auto-reconnect must not open GATT for these pair-state results. */
export type WindowsBleReconnectSkip = 'blocked' | 'unpaired';

export interface WindowsBleReconnectSkipDetail {
  peripheralId: string;
  state: WindowsBleReconnectSkip;
}

const pendingReconnectSkips = new Map<string, WindowsBleReconnectSkipDetail>();
const reconnectSkipListeners = new Set<(detail: WindowsBleReconnectSkipDetail) => void>();

export function subscribeWindowsBleReconnectSkip(
  listener: (detail: WindowsBleReconnectSkipDetail) => void,
): () => void {
  reconnectSkipListeners.add(listener);
  return () => {
    reconnectSkipListeners.delete(listener);
  };
}

export function peekWindowsBleReconnectSkip(
  peripheralId: string,
): WindowsBleReconnectSkipDetail | null {
  return pendingReconnectSkips.get(bleIdMatchKey(peripheralId)) ?? null;
}

export function clearWindowsBleReconnectSkip(peripheralId: string): void {
  pendingReconnectSkips.delete(bleIdMatchKey(peripheralId));
}

/** Test isolation so one case cannot leak a remembered skip into the next. */
export function resetWindowsBleReconnectSkipState(): void {
  pendingReconnectSkips.clear();
}

function publishWindowsBleReconnectSkip(detail: WindowsBleReconnectSkipDetail): void {
  pendingReconnectSkips.set(bleIdMatchKey(detail.peripheralId), detail);
  for (const listener of reconnectSkipListeners) {
    try {
      listener(detail);
    } catch (err) {
      console.debug(
        '[windowsBlePairing] reconnect skip listener ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}

/**
 * Windows auto-reconnect must not enter a WinRT connect when the bond is missing or the
 * pair-state call itself failed. `paired` and `unknown` still connect. A skip is remembered
 * so the connection panel can show the existing unpaired or blocked state.
 */
export async function windowsBleAutoReconnectSkip(
  peripheralId: string,
): Promise<WindowsBleReconnectSkip | null> {
  if (window.electronAPI.getPlatform() !== 'win32') return null;
  const state = await getWindowsBlePairState(peripheralId);
  if (state !== 'blocked' && state !== 'unpaired') return null;
  publishWindowsBleReconnectSkip({ peripheralId, state });
  return state;
}

/**
 * Locale text for a Windows pairing failure. Gatt error codes reuse
 * `connectionPanel.errors.ble.*` when that key exists. The sidecar's English
 * stays on the Error for the log and is not interpolated into the UI.
 */
export function windowsPairingFailureMessage(err: unknown, t: TFunction): string {
  if (err instanceof WindowsBlePairingError) {
    if (err.code === 'authentication_failed') {
      return t('connectionPanel.error.windowsPinRejected');
    }
    const existing = gattBleErrorI18nKey(err.code);
    if (existing) return t(existing);
    if (err.code === 'unsupported') return t('connectionPanel.error.windowsPairingUnsupported');
    if (err.code === 'invalid_profile') {
      return t('connectionPanel.error.windowsPairingInvalidProfile');
    }
    if (err.code === 'invalid_address') {
      return t('connectionPanel.error.windowsPairingInvalidAddress');
    }
  }
  return t('connectionPanel.stagePairingFailed');
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
