import { isValidLatLon } from '@/shared/geoCoords';
import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';
import type { ReticulumRmapDiscoveredWireRow } from '@/shared/reticulum-types';
import type { TAKNodeUpdate } from '@/shared/tak-types';

import { getNodeStatus } from './nodeStatus';
import { getRadioCapabilities } from './radio/providerFactory';
import { reticulumHashToNodeId } from './reticulum/destHash';
import { MS_PER_MINUTE, MS_PER_SECOND } from './timeConstants';
import type { MeshNode } from './types';

/** Node-store churn is coalesced into at most one change scan per interval. */
export const TAK_NODE_SCAN_INTERVAL_MS = 2 * MS_PER_SECOND;

/**
 * Re-send every eligible node on this cadence. A CoT event goes stale 10 minutes after it is
 * sent (main `cot-converter.ts`), so a node whose position stops changing, such as a fixed
 * repeater, would otherwise drop off the ATAK map.
 */
export const TAK_NODE_REFRESH_MS = 5 * MS_PER_MINUTE;

/** Our own Reticulum position; the stack has no GPS of its own, so this comes from app GPS. */
export interface TakReticulumSelf {
  nodeId: number;
  name: string;
  latitude: number;
  longitude: number;
}

export interface TakFeedSources {
  nodesByProtocol: Readonly<Record<MeshProtocol, ReadonlyMap<number, MeshNode>>>;
  /** RMAP-discovered Reticulum interfaces; only rows with coordinates become markers. */
  rmapRows: readonly ReticulumRmapDiscoveredWireRow[];
  reticulumSelf: TakReticulumSelf | null;
}

/** Valid WGS84 pair, excluding the (0, 0) placeholder radios report before a GPS fix. */
function hasMapPosition(lat: number, lon: number): boolean {
  return isValidLatLon(lat, lon) && !(lat === 0 && lon === 0);
}

/** Uses the protocol's own online window (Meshtastic 2 h, MeshCore 48 h, Reticulum 7 d). */
function isOnline(lastHeard: number, protocol: MeshProtocol): boolean {
  const { nodeStaleThresholdMs, nodeOfflineThresholdMs } = getRadioCapabilities(protocol);
  return getNodeStatus(lastHeard, nodeStaleThresholdMs, nodeOfflineThresholdMs) === 'online';
}

export function meshNodeToTakUpdate(node: MeshNode, protocol: MeshProtocol): TAKNodeUpdate | null {
  const { latitude, longitude } = node;
  if (node.node_id <= 0 || latitude == null || longitude == null) return null;
  if (!hasMapPosition(latitude, longitude)) return null;
  if (!isOnline(node.last_heard, protocol)) return null;
  const update: TAKNodeUpdate = {
    node_id: node.node_id,
    protocol,
    latitude,
    longitude,
    short_name: node.short_name,
    long_name: node.long_name,
    battery: node.battery,
    last_heard: node.last_heard,
  };
  if (node.altitude != null) update.altitude = node.altitude;
  return update;
}

export function rmapRowToTakUpdate(row: ReticulumRmapDiscoveredWireRow): TAKNodeUpdate | null {
  if (!row.has_coordinates || !hasMapPosition(row.latitude, row.longitude)) return null;
  if (!isOnline(row.last_heard, 'reticulum')) return null;
  // discovery_hash is hex SHA-256 (rsReticulum DiscoveredInterface::filename).
  const nodeId = reticulumHashToNodeId(row.discovery_hash);
  if (nodeId <= 0) return null;
  return {
    node_id: nodeId,
    protocol: 'reticulum',
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.height,
    short_name: '',
    long_name: row.discovery_name || row.interface_type,
    last_heard: row.last_heard,
  };
}

/** Every node that should currently be on the TAK map, across all protocols. */
export function collectTakNodeUpdates(sources: TakFeedSources): TAKNodeUpdate[] {
  const out: TAKNodeUpdate[] = [];
  for (const protocol of REGISTERED_MESH_PROTOCOLS) {
    for (const node of sources.nodesByProtocol[protocol].values()) {
      const update = meshNodeToTakUpdate(node, protocol);
      if (update) out.push(update);
    }
  }
  for (const row of sources.rmapRows) {
    const update = rmapRowToTakUpdate(row);
    if (update) out.push(update);
  }
  const self = sources.reticulumSelf;
  if (self && self.nodeId > 0 && hasMapPosition(self.latitude, self.longitude)) {
    out.push({
      node_id: self.nodeId,
      protocol: 'reticulum',
      latitude: self.latitude,
      longitude: self.longitude,
      short_name: '',
      long_name: self.name,
      last_heard: Math.floor(Date.now() / MS_PER_SECOND),
    });
  }
  return out;
}

/** Cache key matching main's TAK node cache. */
export function takNodeUpdateKey(update: TAKNodeUpdate): string {
  return `${update.protocol}:${update.node_id}`;
}

/** Fields that change what ATAK shows; last_heard alone does not warrant a re-send. */
export function takNodeUpdateSignature(update: TAKNodeUpdate): string {
  return [
    update.latitude,
    update.longitude,
    update.altitude ?? '',
    update.short_name ?? '',
    update.long_name ?? '',
    update.battery ?? '',
  ].join('|');
}
