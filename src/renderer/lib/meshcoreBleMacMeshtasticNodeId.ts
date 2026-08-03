import { normalizeBleMac } from '@/shared/normalizeBleMac';

/**
 * Meshtastic nodeNum from a BLE MAC: lower 32 bits (last 4 octets).
 * Example: `cc:2e:e3:da:2e:2f` → `0xe3da2e2f`.
 */
export function meshcoreBleMacToMeshtasticNodeId(mac: string): number | null {
  const normalized = normalizeBleMac(mac);
  const hex = normalized.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 12) return null;
  const lower32 = Number.parseInt(hex.slice(4), 16);
  if (!Number.isFinite(lower32)) return null;
  return lower32 >>> 0;
}

/**
 * True when `nodeId` is the MAC-derived Meshtastic identity of the currently
 * connected MeshCore BLE radio — co-channel MeshCore TX must not keep that
 * ghost Meshtastic NodeDB row "Just now".
 */
export function shouldSuppressMeshtasticNodeHear(
  nodeId: number,
  connectedMeshcoreBleMac: string | null | undefined,
): boolean {
  if (nodeId === 0 || !connectedMeshcoreBleMac) return false;
  const macNodeId = meshcoreBleMacToMeshtasticNodeId(connectedMeshcoreBleMac);
  if (macNodeId == null) return false;
  return nodeId >>> 0 === macNodeId;
}
