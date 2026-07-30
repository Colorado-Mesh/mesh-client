import { isValidLatLon } from '@/shared/geoCoords';
import type {
  ReticulumPeerWireRow,
  ReticulumRmapDiscoveredWireRow,
} from '@/shared/reticulum-types';

export type RmapInterfaceFilter = 'all' | 'rnode' | 'i2p' | 'tcp' | 'backbone' | 'other';

export interface ReticulumMapMarkerRow extends ReticulumRmapDiscoveredWireRow {
  reachable: boolean;
  /** Resolved destination_hash for peer detail modal; null when heard-only. */
  peerDetailHash: string | null;
}

export interface ReticulumMapLayout {
  markers: ReticulumMapMarkerRow[];
  listOnly: ReticulumMapMarkerRow[];
}

function normalizeInterfaceFamily(type: string): RmapInterfaceFilter {
  const t = type.trim().toLowerCase();
  if (t.includes('rnode') || t.includes('kiss') || t.includes('weave')) {
    return 'rnode';
  }
  if (t.includes('i2p')) {
    return 'i2p';
  }
  if (t.includes('tcpclient')) {
    return 'tcp';
  }
  if (t.includes('backbone') || t.includes('tcpserver')) {
    return 'backbone';
  }
  return 'other';
}

export function matchesRmapInterfaceFilter(
  row: Pick<ReticulumRmapDiscoveredWireRow, 'interface_type'>,
  filter: RmapInterfaceFilter,
): boolean {
  if (filter === 'all') {
    return true;
  }
  return normalizeInterfaceFamily(row.interface_type) === filter;
}

function peerTransportIds(peers: ReticulumPeerWireRow[]): Set<string> {
  const out = new Set<string>();
  for (const peer of peers) {
    const hash = peer.destination_hash.trim().toLowerCase();
    if (hash) {
      out.add(hash);
    }
    const via = peer.via_hash?.trim().toLowerCase();
    if (via) {
      out.add(via);
    }
  }
  return out;
}

/** Resolve transport_id to a path-table destination_hash for peer detail modal. */
export function resolveRmapPeerDetailHash(
  transportId: string,
  peers: ReticulumPeerWireRow[],
): string | null {
  const tid = transportId.trim().toLowerCase();
  if (!tid) return null;
  for (const peer of peers) {
    const dest = peer.destination_hash.trim().toLowerCase();
    if (dest && dest === tid) {
      return dest;
    }
  }
  for (const peer of peers) {
    const via = peer.via_hash?.trim().toLowerCase();
    if (via && via === tid) {
      return via;
    }
  }
  return null;
}

export function joinRmapDiscoveryWithPeers(
  discovered: ReticulumRmapDiscoveredWireRow[],
  peers: ReticulumPeerWireRow[],
): ReticulumMapLayout {
  const reachableIds = peerTransportIds(peers);
  const enriched: ReticulumMapMarkerRow[] = discovered.map((row) => ({
    ...row,
    reachable: reachableIds.has(row.transport_id.trim().toLowerCase()),
    peerDetailHash: resolveRmapPeerDetailHash(row.transport_id, peers),
  }));

  const markers: ReticulumMapMarkerRow[] = [];
  const listOnly: ReticulumMapMarkerRow[] = [];
  for (const row of enriched) {
    const hasCoords =
      row.has_coordinates &&
      isValidLatLon(row.latitude, row.longitude) &&
      !(row.latitude === 0 && row.longitude === 0);
    if (hasCoords) {
      markers.push(row);
    } else {
      listOnly.push(row);
    }
  }

  return { markers, listOnly };
}

/** LoRa param match hint for nearby operators (frequency + BW + SF). */
export function rmapLoRaParamsMatch(
  a: Pick<
    ReticulumRmapDiscoveredWireRow,
    'frequency' | 'bandwidth' | 'spreading_factor' | 'interface_type'
  >,
  b: Pick<
    ReticulumRmapDiscoveredWireRow,
    'frequency' | 'bandwidth' | 'spreading_factor' | 'interface_type'
  >,
): boolean {
  if (normalizeInterfaceFamily(a.interface_type) !== 'rnode') {
    return false;
  }
  if (normalizeInterfaceFamily(b.interface_type) !== 'rnode') {
    return false;
  }
  return (
    a.frequency != null &&
    a.frequency === b.frequency &&
    a.bandwidth != null &&
    a.bandwidth === b.bandwidth &&
    a.spreading_factor != null &&
    a.spreading_factor === b.spreading_factor
  );
}

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}
