import { getConnection } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { resolveLastBlePeripheralId } from './lastConnectionStorage';
import { MESH_PROTOCOL_STORAGE_KEY } from './storedMeshProtocol';
import {
  MESHCORE_DUAL_NOBLE_BLE_GET_CONTACTS_DEFER_MS,
  MESHCORE_DUAL_NOBLE_BLE_POLL_MS,
  POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS,
} from './timeConstants';
import type { MeshProtocol } from './types';

/**
 * Sidecar GATT is used on all platforms for Meshtastic/MeshCore BLE.
 * Kept for call sites that previously branched Linux Web Bluetooth vs Noble.
 */
export function isRendererGattBlePlatform(): boolean {
  return true;
}

/** @deprecated Use isRendererGattBlePlatform */
export const isRendererNobleBlePlatform = isRendererGattBlePlatform;

/**
 * USB serial and TCP share single-flight companion RPC + WritableStream writes;
 * init must run getSelfInfo → getContacts → getChannels before post-init side effects.
 * Sidecar GATT BLE keeps parallel overlap.
 */
export function needsSequentialMeshcoreRadioInit(transport: 'ble' | 'serial' | 'tcp'): boolean {
  return transport !== 'ble';
}

function bleConfigureBusyForProtocolType(protocolType: MeshProtocol): boolean {
  const { identities } = useIdentityStore.getState();
  for (const identity of Object.values(identities)) {
    if (identity.protocol.type !== protocolType) continue;
    const conn = getConnection(identity.id);
    if (conn?.connectionType !== 'ble') continue;
    if (conn.status === 'connecting' || conn.status === 'connected') return true;
  }
  return false;
}

/** Meshtastic identity on BLE that has not reached `configured` yet. */
export function meshtasticNobleBleConfigureBusy(): boolean {
  return bleConfigureBusyForProtocolType('meshtastic');
}

/** MeshCore identity on BLE that has not reached `configured` yet. */
export function meshcoreNobleBleConfigureBusy(): boolean {
  return bleConfigureBusyForProtocolType('meshcore');
}

/** True when the given protocol has a BLE session still configuring. */
export function nobleBleConfigureBusyForProtocol(protocol: MeshProtocol): boolean {
  return bleConfigureBusyForProtocolType(protocol);
}

/**
 * MeshCore and Meshtastic cannot hold separate GATT sessions to the same peripheral.
 * Skip MeshCore BLE auto-connect when it targets the same device as Meshtastic RF.
 */
export function meshcoreTargetsSharedMeshtasticBlePeripheral(
  meshcoreBlePeripheralId: string | null | undefined,
): boolean {
  if (!meshcoreBlePeripheralId) return false;
  const meshtasticBleId = resolveLastBlePeripheralId('meshtastic');
  return Boolean(meshtasticBleId && meshtasticBleId === meshcoreBlePeripheralId);
}

/** Both stacks have separate BLE peripherals saved (dual-radio startup). */
export function dualNobleBleBothRadiosConfigured(): boolean {
  const meshcoreBleId = resolveLastBlePeripheralId('meshcore');
  const meshtasticBleId = resolveLastBlePeripheralId('meshtastic');
  if (!meshcoreBleId || !meshtasticBleId) return false;
  return !meshcoreTargetsSharedMeshtasticBlePeripheral(meshcoreBleId);
}

/** Dual-radio BLE: which RF protocol auto-connects first (last active tab, or Meshtastic default). */
let bleDualRadioPrimary: MeshProtocol | null = null;
let blePrimaryAutoConnectSettled = true;
let blePrimaryAutoConnectSettledPromise: Promise<void> = Promise.resolve();
let resolveBlePrimaryAutoConnectSettled: (() => void) | null = null;
let bleDualRadioStartupInitialized = false;

/**
 * Last active mesh protocol tab decides dual-radio order; Reticulum falls back to Meshtastic.
 * Single-radio installs return null (no peer deferral).
 */
export function resolveNobleBleDualRadioPrimaryProtocol(): MeshProtocol | null {
  if (!dualNobleBleBothRadiosConfigured()) return null;
  const stored = localStorage.getItem(MESH_PROTOCOL_STORAGE_KEY);
  if (stored === 'meshcore') return 'meshcore';
  if (stored === 'meshtastic') return 'meshtastic';
  return 'meshtastic';
}

export function getNobleBleDualRadioPrimaryProtocol(): MeshProtocol | null {
  return bleDualRadioPrimary;
}

export function isNobleBleDualRadioSecondary(protocol: MeshProtocol): boolean {
  return (
    dualNobleBleBothRadiosConfigured() &&
    bleDualRadioPrimary !== null &&
    protocol !== bleDualRadioPrimary
  );
}

/** Call once on app mount (useLayoutEffect) before ConnectionPanel auto-connect effects run. */
export function initNobleBleDualRadioStartup(): void {
  if (bleDualRadioStartupInitialized) return;
  bleDualRadioStartupInitialized = true;
  bleDualRadioPrimary = resolveNobleBleDualRadioPrimaryProtocol();
  if (dualNobleBleBothRadiosConfigured() && bleDualRadioPrimary) {
    blePrimaryAutoConnectSettled = false;
    blePrimaryAutoConnectSettledPromise = new Promise<void>((resolve) => {
      resolveBlePrimaryAutoConnectSettled = resolve;
    });
  } else {
    blePrimaryAutoConnectSettled = true;
    blePrimaryAutoConnectSettledPromise = Promise.resolve();
    resolveBlePrimaryAutoConnectSettled = null;
  }
}

/** Primary protocol auto-connect finished (success or failure) — unblocks secondary. */
export function notifyNobleBlePrimaryAutoConnectSettled(): void {
  if (blePrimaryAutoConnectSettled) return;
  blePrimaryAutoConnectSettled = true;
  resolveBlePrimaryAutoConnectSettled?.();
  resolveBlePrimaryAutoConnectSettled = null;
}

/**
 * Primary RF link is up (GATT + protocol handshake) — unblock secondary before full configure.
 * Idempotent; safe to call from transport connect success paths.
 */
export function notifyBlePrimaryRfLinkReady(protocol: MeshProtocol): void {
  if (
    !dualNobleBleBothRadiosConfigured() ||
    bleDualRadioPrimary !== protocol ||
    blePrimaryAutoConnectSettled
  ) {
    return;
  }
  notifyNobleBlePrimaryAutoConnectSettled();
}

/** @deprecated Use notifyBlePrimaryRfLinkReady */
export const notifyNobleBlePrimaryRfLinkReady = notifyBlePrimaryRfLinkReady;

/**
 * Secondary protocol waits for the primary auto-connect attempt to finish (or timeout).
 * Failure point: primary never settles — proceed after cap so secondary is not stuck forever.
 */
export async function awaitNobleBlePrimaryAutoConnectSettled(
  maxWaitMs = POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS,
): Promise<void> {
  if (blePrimaryAutoConnectSettled) return;
  await Promise.race([
    blePrimaryAutoConnectSettledPromise,
    new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
  ]);
}

/**
 * Poll until the given protocol's BLE session finishes configure (or timeout).
 * Failure point: protocol never configures — proceed after cap.
 */
export async function awaitNobleBleProtocolSettle(
  protocol: MeshProtocol,
  maxWaitMs: number,
): Promise<void> {
  const startMs = Date.now();
  const deadline = startMs + maxWaitMs;
  while (Date.now() < deadline) {
    if (!nobleBleConfigureBusyForProtocol(protocol)) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, MESHCORE_DUAL_NOBLE_BLE_POLL_MS));
  }
}

/**
 * When both stacks share the BLE adapter, defer MeshCore contact dump until Meshtastic
 * finishes configure (or timeout). Failure point: Meshtastic never configures — proceed after cap.
 */
export async function awaitDualNobleBleMeshtasticSettle(
  maxWaitMs = MESHCORE_DUAL_NOBLE_BLE_GET_CONTACTS_DEFER_MS,
): Promise<void> {
  await awaitNobleBleProtocolSettle('meshtastic', maxWaitMs);
}

/** @internal Test-only reset for dual-radio startup state. */
export function resetNobleBleConnectMutexForTests(): void {
  bleDualRadioPrimary = null;
  blePrimaryAutoConnectSettled = true;
  blePrimaryAutoConnectSettledPromise = Promise.resolve();
  resolveBlePrimaryAutoConnectSettled = null;
  bleDualRadioStartupInitialized = false;
}

/** @deprecated Mutex removed — sidecar GATT serializes in main; passthrough for call-site cleanup. */
export async function withNobleBleConnectMutex<T>(
  _protocol: MeshProtocol,
  work: () => Promise<T>,
): Promise<T> {
  return work();
}

export interface NobleBleConnectMutexSnapshot {
  queued: MeshProtocol | null;
  active: MeshProtocol | null;
  primaryAutoConnectInFlight: boolean;
  primaryProtocol: MeshProtocol | null;
}

export function getNobleBleConnectMutexSnapshot(): NobleBleConnectMutexSnapshot {
  return {
    queued: null,
    active: null,
    primaryAutoConnectInFlight: dualNobleBleBothRadiosConfigured() && !blePrimaryAutoConnectSettled,
    primaryProtocol: bleDualRadioPrimary,
  };
}

/** No-op: connect mutex was removed when LoRa BLE moved to sidecar GATT. */
export function subscribeNobleBleConnectMutexWait(): () => void {
  return () => {};
}
