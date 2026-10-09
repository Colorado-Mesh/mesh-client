import { isValidLatLon } from '@/shared/geoCoords';
import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';
import type { ReticulumRmapDiscoveredWireRow } from '@/shared/reticulum-types';
import type { TAKNodeUpdate } from '@/shared/tak-types';

import { type TakTrackerEntry, takTrackerExpiresAtMs } from '../stores/takTrackerStore';
import { mt1StableUid } from './meshcore/mt1Tracker';
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
  /** Latest `!MT1` fix per tracker heard on an enabled MeshCore channel. */
  trackerFixes?: readonly TakTrackerEntry[];
}

/** A tracker fix while it is still valid; expired fixes drop off. */
export function trackerFixToTakUpdate(
  entry: TakTrackerEntry,
  nowMs: number = Date.now(),
): TAKNodeUpdate | null {
  const { fix } = entry;
  if (nowMs >= takTrackerExpiresAtMs(entry)) return null;
  if (!hasMapPosition(fix.lat, fix.lon)) return null;
  const nodeId = parseInt(fix.id8, 16);
  if (!Number.isInteger(nodeId) || nodeId <= 0) return null;
  const update: TAKNodeUpdate = {
    node_id: nodeId,
    protocol: 'meshcore',
    uid: mt1StableUid(fix.id8),
    latitude: fix.lat,
    longitude: fix.lon,
    short_name: '',
    long_name: fix.callsign,
    last_heard: Math.floor(entry.receivedAtMs / MS_PER_SECOND),
    source: 'rf',
  };
  if (fix.altitude != null) update.altitude = fix.altitude;
  if (fix.battery != null) update.battery = fix.battery;
  if (fix.role) update.tracker_role = fix.role;
  if (fix.speed != null) update.speed = fix.speed;
  if (fix.course != null) update.course = fix.course;
  if (fix.seq != null) update.sequence = fix.seq;
  if (fix.staleSec != null) update.stale_sec = fix.staleSec;
  if (entry.hops != null) update.hops_away = entry.hops;
  return update;
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
    source: node.source === 'mqtt' || node.heard_via_mqtt_only ? 'mqtt' : 'rf',
  };
  if (node.altitude != null) update.altitude = node.altitude;
  if (node.hw_model) update.hw_model = node.hw_model;
  if (node.role != null) update.role = node.role;
  const hops = node.hops_away ?? node.hops;
  if (hops != null) update.hops_away = hops;
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
    infrastructure: true,
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
  const nowMs = Date.now();
  for (const entry of sources.trackerFixes ?? []) {
    const update = trackerFixToTakUpdate(entry, nowMs);
    if (update) out.push(update);
  }
  return out;
}

/** Cache key matching main's TAK node cache. */
export function takNodeUpdateKey(update: TAKNodeUpdate): string {
  return update.uid ?? `${update.protocol}:${update.node_id}`;
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
    update.hw_model ?? '',
    update.role ?? '',
    update.hops_away ?? '',
    update.source ?? '',
    update.tracker_role ?? '',
    update.speed ?? '',
    update.course ?? '',
    update.sequence ?? '',
    update.stale_sec ?? '',
  ].join('|');
}
