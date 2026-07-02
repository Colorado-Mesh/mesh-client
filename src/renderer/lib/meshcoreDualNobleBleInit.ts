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

/** True when the renderer uses Noble IPC for BLE (macOS / Windows), not Web Bluetooth. */
export function isRendererNobleBlePlatform(): boolean {
  if (typeof window !== 'undefined' && window.electronAPI?.getPlatform) {
    return window.electronAPI.getPlatform() !== 'linux';
  }
  try {
    if (typeof process !== 'undefined' && process.platform === 'linux') return false;
  } catch {
    // catch-no-log-ok process may be unavailable in some renderer bundles
  }
  if (typeof navigator === 'undefined') return true;
  const ua = navigator.userAgent ?? '';
  if (/Linux/i.test(ua)) return false;
  const plat = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  if (plat && /Linux/i.test(plat)) return false;
  if (navigator.platform && /Linux/i.test(navigator.platform)) return false;
  return true;
}

/**
 * USB serial and Linux Web Bluetooth share single-flight companion RPC + WritableStream
 * writes; init must run getSelfInfo → getContacts → getChannels before post-init side effects.
 * Noble BLE (macOS/Windows) and TCP keep parallel overlap.
 */
export function needsSequentialMeshcoreRadioInit(transport: 'ble' | 'serial' | 'tcp'): boolean {
  return transport === 'serial' || (transport === 'ble' && !isRendererNobleBlePlatform());
}

function nobleBleConfigureBusyForProtocolType(protocolType: MeshProtocol): boolean {
  const { identities } = useIdentityStore.getState();
  for (const identity of Object.values(identities)) {
    if (identity.protocol.type !== protocolType) continue;
    const conn = getConnection(identity.id);
    if (conn?.connectionType !== 'ble') continue;
    if (conn.status === 'connecting' || conn.status === 'connected') return true;
  }
  return false;
}

/** Meshtastic identity on Noble BLE that has not reached `configured` yet. */
export function meshtasticNobleBleConfigureBusy(): boolean {
  return nobleBleConfigureBusyForProtocolType('meshtastic');
}

/** MeshCore identity on Noble BLE that has not reached `configured` yet. */
export function meshcoreNobleBleConfigureBusy(): boolean {
  return nobleBleConfigureBusyForProtocolType('meshcore');
}

/** True when the given protocol has a Noble BLE session still configuring. */
export function nobleBleConfigureBusyForProtocol(protocol: MeshProtocol): boolean {
  return nobleBleConfigureBusyForProtocolType(protocol);
}

/**
 * MeshCore and Meshtastic cannot hold separate Noble GATT sessions to the same peripheral.
 * Skip MeshCore BLE auto-connect when it targets the same device as Meshtastic RF.
 */
export function meshcoreTargetsSharedMeshtasticBlePeripheral(
  meshcoreBlePeripheralId: string | null | undefined,
): boolean {
  if (!meshcoreBlePeripheralId) return false;
  const meshtasticBleId = resolveLastBlePeripheralId('meshtastic');
  return Boolean(meshtasticBleId && meshtasticBleId === meshcoreBlePeripheralId);
}

/** Both stacks have separate Noble BLE peripherals saved (dual-radio startup). */
export function dualNobleBleBothRadiosConfigured(): boolean {
  if (!isRendererNobleBlePlatform()) return false;
  const meshcoreBleId = resolveLastBlePeripheralId('meshcore');
  const meshtasticBleId = resolveLastBlePeripheralId('meshtastic');
  if (!meshcoreBleId || !meshtasticBleId) return false;
  return !meshcoreTargetsSharedMeshtasticBlePeripheral(meshcoreBleId);
}

/** Dual-radio Noble BLE: which RF protocol auto-connects first (last active tab, or Meshtastic default). */
let nobleBleDualRadioPrimary: MeshProtocol | null = null;
let nobleBlePrimaryAutoConnectSettled = true;
let nobleBlePrimaryAutoConnectSettledPromise: Promise<void> = Promise.resolve();
let resolveNobleBlePrimaryAutoConnectSettled: (() => void) | null = null;
let nobleBleDualRadioStartupInitialized = false;

function notifyNobleBleMutexListeners(): void {
  nobleBleMutexListeners.forEach((listener) => {
    listener();
  });
}

/**
 * Last active mesh protocol tab decides dual-radio Noble order; Reticulum falls back to Meshtastic.
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
  return nobleBleDualRadioPrimary;
}

export function isNobleBleDualRadioSecondary(protocol: MeshProtocol): boolean {
  return (
    dualNobleBleBothRadiosConfigured() &&
    nobleBleDualRadioPrimary !== null &&
    protocol !== nobleBleDualRadioPrimary
  );
}

/** Call once on app mount (useLayoutEffect) before ConnectionPanel auto-connect effects run. */
export function initNobleBleDualRadioStartup(): void {
  if (nobleBleDualRadioStartupInitialized) return;
  nobleBleDualRadioStartupInitialized = true;
  nobleBleDualRadioPrimary = resolveNobleBleDualRadioPrimaryProtocol();
  if (dualNobleBleBothRadiosConfigured() && nobleBleDualRadioPrimary) {
    nobleBlePrimaryAutoConnectSettled = false;
    nobleBlePrimaryAutoConnectSettledPromise = new Promise<void>((resolve) => {
      resolveNobleBlePrimaryAutoConnectSettled = resolve;
    });
  } else {
    nobleBlePrimaryAutoConnectSettled = true;
    nobleBlePrimaryAutoConnectSettledPromise = Promise.resolve();
    resolveNobleBlePrimaryAutoConnectSettled = null;
  }
  notifyNobleBleMutexListeners();
}

/** Primary protocol auto-connect finished (success or failure) — unblocks secondary. */
export function notifyNobleBlePrimaryAutoConnectSettled(): void {
  if (nobleBlePrimaryAutoConnectSettled) return;
  nobleBlePrimaryAutoConnectSettled = true;
  resolveNobleBlePrimaryAutoConnectSettled?.();
  resolveNobleBlePrimaryAutoConnectSettled = null;
  notifyNobleBleMutexListeners();
}

/**
 * Primary RF link is up (GATT + protocol handshake) — unblock secondary before full configure.
 * Idempotent; safe to call from transport connect success paths.
 */
export function notifyNobleBlePrimaryRfLinkReady(protocol: MeshProtocol): void {
  if (
    !dualNobleBleBothRadiosConfigured() ||
    nobleBleDualRadioPrimary !== protocol ||
    nobleBlePrimaryAutoConnectSettled
  ) {
    return;
  }
  notifyNobleBlePrimaryAutoConnectSettled();
}

/**
 * Secondary protocol waits for the primary auto-connect attempt to finish (or timeout).
 * Failure point: primary never settles — proceed after cap so secondary is not stuck forever.
 */
export async function awaitNobleBlePrimaryAutoConnectSettled(
  maxWaitMs = POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS,
): Promise<void> {
  if (nobleBlePrimaryAutoConnectSettled) return;
  await Promise.race([
    nobleBlePrimaryAutoConnectSettledPromise,
    new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
  ]);
}

async function awaitNobleBlePeerBeforeConnect(protocol: MeshProtocol): Promise<void> {
  if (!isNobleBleDualRadioSecondary(protocol)) return;
  await awaitNobleBlePrimaryAutoConnectSettled();
}

/**
 * Poll until the given protocol's Noble BLE session finishes configure (or timeout).
 * Failure point: protocol never configures — proceed after cap.
 */
export async function awaitNobleBleProtocolSettle(
  protocol: MeshProtocol,
  maxWaitMs: number,
): Promise<void> {
  if (!isRendererNobleBlePlatform()) return;
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
 * When both stacks share the Noble adapter, defer MeshCore contact dump until Meshtastic
 * finishes configure (or timeout). Failure point: Meshtastic never configures — proceed after cap.
 */
export async function awaitDualNobleBleMeshtasticSettle(
  maxWaitMs = MESHCORE_DUAL_NOBLE_BLE_GET_CONTACTS_DEFER_MS,
): Promise<void> {
  await awaitNobleBleProtocolSettle('meshtastic', maxWaitMs);
}

/** Serializes Noble IPC BLE connect+handshake across Meshtastic and MeshCore (avoids startup race). */
let nobleBleConnectChain: Promise<void> = Promise.resolve();

export interface NobleBleConnectMutexSnapshot {
  /** Protocol waiting to acquire the mutex (blocked on queue). */
  queued: MeshProtocol | null;
  /** Protocol currently holding the mutex (connect+handshake in progress). */
  active: MeshProtocol | null;
  /** Dual-radio primary protocol auto-connect still in flight. */
  primaryAutoConnectInFlight: boolean;
  /** Primary protocol for dual-radio startup (null when single-radio). */
  primaryProtocol: MeshProtocol | null;
}

let nobleBleMutexSnapshot: NobleBleConnectMutexSnapshot = {
  queued: null,
  active: null,
  primaryAutoConnectInFlight: false,
  primaryProtocol: null,
};
const nobleBleMutexListeners = new Set<() => void>();

function buildNobleBleMutexSnapshot(
  partial: Pick<NobleBleConnectMutexSnapshot, 'queued' | 'active'>,
): NobleBleConnectMutexSnapshot {
  return {
    ...partial,
    primaryAutoConnectInFlight:
      dualNobleBleBothRadiosConfigured() && !nobleBlePrimaryAutoConnectSettled,
    primaryProtocol: nobleBleDualRadioPrimary,
  };
}

function setNobleBleMutexSnapshot(next: NobleBleConnectMutexSnapshot): void {
  nobleBleMutexSnapshot = next;
  notifyNobleBleMutexListeners();
}

export function getNobleBleConnectMutexSnapshot(): NobleBleConnectMutexSnapshot {
  return nobleBleMutexSnapshot;
}

export function subscribeNobleBleConnectMutexWait(listener: () => void): () => void {
  nobleBleMutexListeners.add(listener);
  return () => nobleBleMutexListeners.delete(listener);
}

/**
 * Run one Noble BLE RF connect at a time in the renderer. The main process also serializes GATT
 * setup, but parallel renderer connects still raced during auto-connect before connectionStore
 * reflected `connecting` — Meshtastic could start while MeshCore was mid-handshake.
 */
export async function withNobleBleConnectMutex<T>(
  protocol: MeshProtocol,
  work: () => Promise<T>,
): Promise<T> {
  if (!isRendererNobleBlePlatform()) {
    return work();
  }
  const prev = nobleBleConnectChain;
  let release!: () => void;
  nobleBleConnectChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  setNobleBleMutexSnapshot(
    buildNobleBleMutexSnapshot({ queued: protocol, active: nobleBleMutexSnapshot.active }),
  );
  await awaitNobleBlePeerBeforeConnect(protocol);
  await prev;
  setNobleBleMutexSnapshot(buildNobleBleMutexSnapshot({ queued: null, active: protocol }));
  try {
    return await work();
  } finally {
    release();
    setNobleBleMutexSnapshot(buildNobleBleMutexSnapshot({ queued: null, active: null }));
  }
}

/** @internal Test-only reset for mutex chain state. */
export function resetNobleBleConnectMutexForTests(): void {
  nobleBleConnectChain = Promise.resolve();
  nobleBleDualRadioPrimary = null;
  nobleBlePrimaryAutoConnectSettled = true;
  nobleBlePrimaryAutoConnectSettledPromise = Promise.resolve();
  resolveNobleBlePrimaryAutoConnectSettled = null;
  nobleBleDualRadioStartupInitialized = false;
  setNobleBleMutexSnapshot(buildNobleBleMutexSnapshot({ queued: null, active: null }));
}
