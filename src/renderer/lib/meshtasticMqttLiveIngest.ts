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

/** Auto-launch Meshtastic MQTT on startup only when Meshtastic is the last active tab. */
export function shouldAutoLaunchMeshtasticMqtt(storedProtocol: MeshProtocol): boolean {
  return storedProtocol === 'meshtastic';
}

/** When false, Meshtastic MQTT should not stay connected (MeshCore tab, no RF radio). */
export function shouldMaintainMeshtasticMqttConnection(
  storedProtocol: MeshProtocol,
  hasRfDevice: boolean,
): boolean {
  return shouldIngestMeshtasticMqttLive(storedProtocol, hasRfDevice);
}
