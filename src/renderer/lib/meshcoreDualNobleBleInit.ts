import { getConnection } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { resolveLastBlePeripheralId } from './lastConnectionStorage';
import {
  MESHCORE_DUAL_NOBLE_BLE_GET_CONTACTS_DEFER_MS,
  MESHCORE_DUAL_NOBLE_BLE_POLL_MS,
} from './timeConstants';

/** True when the renderer uses Noble IPC for BLE (macOS / Windows), not Web Bluetooth. */
export function isRendererNobleBlePlatform(): boolean {
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

/** Meshtastic identity on Noble BLE that has not reached `configured` yet. */
export function meshtasticNobleBleConfigureBusy(): boolean {
  const { identities } = useIdentityStore.getState();
  for (const identity of Object.values(identities)) {
    if (identity.protocol.type !== 'meshtastic') continue;
    const conn = getConnection(identity.id);
    if (conn?.connectionType !== 'ble') continue;
    if (conn.status === 'connecting' || conn.status === 'connected') return true;
  }
  return false;
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

/**
 * When both stacks share the Noble adapter, defer MeshCore contact dump until Meshtastic
 * finishes configure (or timeout). Failure point: Meshtastic never configures — proceed after cap.
 */
export async function awaitDualNobleBleMeshtasticSettle(
  maxWaitMs = MESHCORE_DUAL_NOBLE_BLE_GET_CONTACTS_DEFER_MS,
): Promise<void> {
  if (!isRendererNobleBlePlatform()) return;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (!meshtasticNobleBleConfigureBusy()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, MESHCORE_DUAL_NOBLE_BLE_POLL_MS));
  }
}
