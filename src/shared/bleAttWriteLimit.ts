/** Spec default ATT_MTU (Bluetooth Core Spec): minimum 23 octets. */
export const ATT_MTU_DEFAULT = 23;

/** Practical upper bound for ATT_MTU after exchange (spec allows up to 517 for ATT). */
export const ATT_MTU_MAX = 517;

/** Aligns with MeshDevice.sendRaw and main-process IPC cap for noble BLE writes. */
export const BLE_TO_RADIO_PAYLOAD_CAP = 512;

/**
 * Normalize a reported ATT MTU from the stack (e.g. Noble `peripheral.mtu` / `mtu` event).
 * Values below 23 are invalid as ATT_MTU; some bindings report payload-sized quirks (e.g. 20).
 */
export function attMtuOrDefault(mtu: number | null | undefined): number {
  if (mtu == null || typeof mtu !== 'number' || !Number.isFinite(mtu)) {
    return ATT_MTU_DEFAULT;
  }
  const n = Math.floor(mtu);
  if (n < ATT_MTU_DEFAULT) {
    return ATT_MTU_DEFAULT;
  }
  return Math.min(n, ATT_MTU_MAX);
}

/**
 * Max payload bytes per a single ATT Write Request (opcode + handle = 3 octets overhead).
 * Capped to {@link BLE_TO_RADIO_PAYLOAD_CAP} for Meshtastic IPC/core alignment.
 */
export function maxWriteRequestPayloadBytes(mtu: number | null | undefined): number {
  return Math.min(attMtuOrDefault(mtu) - 3, BLE_TO_RADIO_PAYLOAD_CAP);
}
