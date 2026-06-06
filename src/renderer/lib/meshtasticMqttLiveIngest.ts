import { readMeshtasticMqttSettingsFromStorage } from './meshtasticMqttSettingsStorage';
import type { MeshProtocol } from './types';

/**
 * Meshtastic MQTT may stay connected while the MeshCore tab is active (dual-mode).
 * Ingest live MQTT node/chat updates when Meshtastic is the active tab, or when an
 * RF radio is connected so dual-mode users still merge MQTT with live RF state.
 * MeshCore-only users without a Meshtastic radio should not accumulate Meshtastic
 * MQTT traffic in SQLite/UI while on the MeshCore tab.
 */
export function shouldIngestMeshtasticMqttLive(
  storedProtocol: MeshProtocol,
  hasRfDevice: boolean,
): boolean {
  return storedProtocol === 'meshtastic' || hasRfDevice;
}

/** Auto-launch Meshtastic MQTT when Meshtastic is the stored tab or auto-connect is enabled. */
export function shouldAutoLaunchMeshtasticMqtt(storedProtocol: MeshProtocol): boolean {
  if (storedProtocol === 'meshtastic') return true;
  return readMeshtasticMqttSettingsFromStorage().autoLaunch;
}

/** When false, Meshtastic MQTT should not stay connected (MeshCore tab, no RF radio). */
export function shouldMaintainMeshtasticMqttConnection(
  storedProtocol: MeshProtocol,
  hasRfDevice: boolean,
): boolean {
  if (readMeshtasticMqttSettingsFromStorage().autoLaunch) return true;
  return shouldIngestMeshtasticMqttLive(storedProtocol, hasRfDevice);
}
