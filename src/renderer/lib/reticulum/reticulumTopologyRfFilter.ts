import { classifyReticulumInterfaceRow } from './classifyReticulumVia';
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

function exactRfInterfaceMatch(
  peerInterface: string,
  iface: ReticulumTopologyRfInterface,
): boolean {
  const needle = peerInterface.trim().toLowerCase();
  if (needle.length < 2) return false;
  const name = iface.name.trim();
  if (name.length >= 2 && name.toLowerCase() === needle) return true;
  const id = iface.id.trim();
  return id.length >= 2 && id.toLowerCase() === needle;
}

/**
 * True when the path-table interface name exactly matches a configured RF spoke
 * (name or id). No substring matching — "RNode" must not keep "RNode_TCP_East".
 */
export function isReticulumTopologyPeerRf(
  peer: ReticulumTopologyRfPeer,
  interfaces: readonly ReticulumTopologyRfInterface[],
): boolean {
  const name = peer.interface?.trim();
  if (!name) return false;
  return interfaces.filter(isReticulumTopologyInterfaceRf).some((iface) => {
    return exactRfInterfaceMatch(name, iface);
  });
}

export function filterReticulumTopologyRfOnly<
  I extends ReticulumTopologyRfInterface,
  P extends ReticulumTopologyRfPeer,
>(interfaces: readonly I[], peers: readonly P[]): { interfaces: I[]; peers: P[] } {
  const rfInterfaces = interfaces.filter(isReticulumTopologyInterfaceRf);
  const rfPeers = peers.filter((peer) => isReticulumTopologyPeerRf(peer, rfInterfaces));
  return { interfaces: rfInterfaces, peers: rfPeers };
}
