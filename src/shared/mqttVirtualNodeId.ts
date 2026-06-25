/** Upper bound for MQTT-only virtual node IDs (excludes broadcast 0xffffffff). */
export const MQTT_VIRTUAL_NODE_ID_MAX = 0x0fffffff;

export function isStoredMqttVirtualNodeId(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= MQTT_VIRTUAL_NODE_ID_MAX;
}

/** Map a random uint32 to the valid virtual node id range 1..MQTT_VIRTUAL_NODE_ID_MAX. */
export function randomMqttVirtualNodeId(randomUint32: number): number {
  const masked = (randomUint32 & MQTT_VIRTUAL_NODE_ID_MAX) >>> 0;
  return masked === 0 ? 1 : masked;
}
