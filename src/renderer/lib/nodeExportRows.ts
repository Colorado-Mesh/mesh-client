import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import { nodeHealthScore } from './nodeHealthScore';
import { getNodeStatus, lastHeardToUnixSeconds } from './nodeStatus';
import type { MeshNode } from './types';

export interface NodeExportRowOptions {
  protocol: string;
  staleThresholdMs?: number;
  offlineThresholdMs?: number;
  nowMs?: number;
}

/**
 * Node List export rows: the legacy JSON fields plus the topology fields from
 * `TOPOLOGY_NODE_FIELDS` (status, health_score, protocol, utilization).
 */
export function nodesToExportRows(
  nodes: readonly MeshNode[],
  opts: NodeExportRowOptions,
): Record<string, unknown>[] {
  const nowMs = opts.nowMs ?? Date.now();
  return nodes.map((n) => ({
    node_id: n.node_id,
    hex_id: formatMeshtasticNodeId(n.node_id),
    long_name: n.long_name,
    short_name: n.short_name,
    status: getNodeStatus(n.last_heard, opts.staleThresholdMs, opts.offlineThresholdMs),
    health_score: nodeHealthScore(n, nowMs).total,
    channel_utilization: n.channel_utilization,
    air_util_tx: n.air_util_tx,
    hw_model: n.hw_model,
    snr: n.snr,
    rssi: n.rssi,
    battery: n.battery,
    voltage: n.voltage,
    latitude: n.latitude,
    longitude: n.longitude,
    protocol: opts.protocol,
    last_heard: lastHeardToUnixSeconds(n.last_heard),
    last_heard_unit: 'unix_sec',
    altitude: n.altitude,
    hops_away: n.hops_away,
    via_mqtt: n.via_mqtt,
    favorited: n.favorited,
  }));
}
