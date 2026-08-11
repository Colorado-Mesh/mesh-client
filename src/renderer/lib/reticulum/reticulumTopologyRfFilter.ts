import {
  classifyReticulumInterfaceRow,
  classifyReticulumPathInterfaceName,
  classifyReticulumVia,
} from './classifyReticulumVia';
import { pathMediumFromInterfaceNameOrType } from './reticulumPathMedium';

/** Configured topology interface fields needed to classify RF vs network. */
export interface ReticulumTopologyRfInterface {
  id: string;
  name: string;
  type?: string | null;
  serial_port?: string | null;
}

export interface ReticulumTopologyRfPeer {
  destination_hash?: string | null;
  interface?: string | null;
}

/** True when the configured interface is RF (RNode / KISS / LoRa / BLE RNode / BLE Peer). */
export function isReticulumTopologyInterfaceRf(iface: ReticulumTopologyRfInterface): boolean {
  const via = classifyReticulumInterfaceRow({
    type: iface.type ?? '',
    name: iface.name,
    serial_port: iface.serial_port,
  });
  if (via === 'rf' || via === 'ble') return true;
  return pathMediumFromInterfaceNameOrType(iface.type || iface.name) === 'rf';
}

/** True when the path-table interface name is RF, using configured rows when they match. */
export function isReticulumTopologyPeerRf(
  peer: ReticulumTopologyRfPeer,
  interfaces: readonly ReticulumTopologyRfInterface[],
): boolean {
  const name = peer.interface?.trim();
  if (!name) return false;
  const via = classifyReticulumPathInterfaceName(
    name,
    interfaces.map((iface) => ({
      id: iface.id,
      type: iface.type ?? '',
      name: iface.name,
      serial_port: iface.serial_port,
    })),
  );
  if (via === 'rf' || via === 'ble') return true;
  return pathMediumFromInterfaceNameOrType(name) === 'rf' || classifyReticulumVia(name) === 'rf';
}

export function filterReticulumTopologyRfOnly<
  I extends ReticulumTopologyRfInterface,
  P extends ReticulumTopologyRfPeer,
>(interfaces: readonly I[], peers: readonly P[]): { interfaces: I[]; peers: P[] } {
  const rfInterfaces = interfaces.filter(isReticulumTopologyInterfaceRf);
  const rfIdSet = new Set(rfInterfaces.map((iface) => iface.id));
  const rfPeers = peers.filter((peer) => {
    const needle = peer.interface?.trim();
    if (!needle) return false;
    const lower = needle.toLowerCase();
    for (const iface of rfInterfaces) {
      if (iface.name.toLowerCase() === lower || iface.id.toLowerCase() === lower) {
        return rfIdSet.has(iface.id);
      }
    }
    for (const iface of rfInterfaces) {
      const name = iface.name.toLowerCase();
      if (name.includes(lower) || lower.includes(name)) {
        return rfIdSet.has(iface.id);
      }
    }
    return false;
  });
  return { interfaces: rfInterfaces, peers: rfPeers };
}
