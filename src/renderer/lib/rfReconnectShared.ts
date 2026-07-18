/** Shared RF reconnect policy constants for Meshtastic and MeshCore runtimes. */
export const RF_MAX_RECONNECT_ATTEMPTS = 5;

/** BLE gets a longer attempt budget for spotty civilian RF conditions. */
export const RF_MAX_RECONNECT_ATTEMPTS_BLE = 8;

/**
 * Serial also gets a longer budget so gesture-free `getPorts()` rediscovery
 * (via reconnectSerial) can wait out USB re-enumeration before escalating.
 */
export const RF_MAX_RECONNECT_ATTEMPTS_SERIAL = 8;

/** Resolve reconnect attempt budget for the active transport. */
export function rfMaxReconnectAttemptsForTransport(transport: string | null | undefined): number {
  if (transport === 'ble') return RF_MAX_RECONNECT_ATTEMPTS_BLE;
  if (transport === 'serial') return RF_MAX_RECONNECT_ATTEMPTS_SERIAL;
  return RF_MAX_RECONNECT_ATTEMPTS;
}
