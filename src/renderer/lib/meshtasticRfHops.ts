/**
 * Meshtastic RF hop count from mesh packet hop limit fields (same semantics as node hop updates).
 * Returns undefined for MQTT-only packets or when hop fields do not imply a valid path length.
 */
export function meshtasticComputedRfHopsAway(meshPacket: {
  hopStart?: number;
  hopLimit?: number;
  viaMqtt?: boolean;
}): number | undefined {
  const packetViaMqtt = meshPacket.viaMqtt === true;
  const hopStart = meshPacket.hopStart ?? 0;
  const hopLimit = meshPacket.hopLimit ?? 0;
  if (packetViaMqtt) return undefined;
  if (hopStart > 0 && hopLimit <= hopStart) return hopStart - hopLimit;
  return undefined;
}
