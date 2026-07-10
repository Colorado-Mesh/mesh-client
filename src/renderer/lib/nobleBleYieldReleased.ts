/** Dispatched after Reticulum releases a Noble BLE yield (Meshtastic/MeshCore should reconnect). */
export const NOBLE_BLE_YIELD_RELEASED_EVENT = 'mesh-client:nobleBleYieldReleased';

export function dispatchNobleBleYieldReleased(): void {
  window.dispatchEvent(new CustomEvent(NOBLE_BLE_YIELD_RELEASED_EVENT));
}
