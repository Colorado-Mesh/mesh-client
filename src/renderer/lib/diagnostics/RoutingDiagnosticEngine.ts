import { haversineDistanceKm } from '../nodeStatus';
import type { ProtocolCapabilities } from '../radio/BaseRadioProvider';
import type { HopHistoryPoint, MeshNode, NodeAnomaly } from '../types';

export function detectHopGoblin(
  node: MeshNode,
  homeNode: MeshNode | null,
  ignoreMqtt = false,
  distanceMultiplier = 1,
  distanceOffsetKm = 0,
  hopsThreshold = 2,
): NodeAnomaly | null {
  if (ignoreMqtt && node.heard_via_mqtt_only) return null;

  // Only distance-proven over-hopping. SNR+hops heuristics removed: rxSnr is
  // last-hop only and meaningless for multi-hop originators and MQTT-only nodes.
  if (homeNode?.latitude && homeNode?.longitude && node.latitude && node.longitude) {
    const distKm = haversineDistanceKm(
      homeNode.latitude,
      homeNode.longitude,
      node.latitude,
      node.longitude,
    );
    if (
      distKm < 3 * distanceMultiplier + distanceOffsetKm &&
      (node.hops_away ?? 0) > hopsThreshold
    ) {
      return {
        nodeId: node.node_id,
        type: 'hop_goblin',
        severity: 'error',
        confidence: 'proven',
        description: `Only ${distKm.toFixed(2)} km away but taking ${node.hops_away ?? '?'} hops — critical over-hopping`,
        detectedAt: Date.now(),
        snr: node.snr,
        hopsAway: node.hops_away,
      };
    }
  }
  return null;
}

export function detectBadRoute(
  node: MeshNode,
  stats: { total: number; duplicates: number } | undefined,
  homeNode: MeshNode | null,
  ignoreMqtt = false,
  distanceMultiplier = 1,
  distanceOffsetKm = 0,
  /** Align with ENV_PARAMS hops (2/3/4); close-in hop warning uses hopsThreshold+2 vs legacy fixed 4 */
  hopsThreshold = 2,
): NodeAnomaly | null {
  // High duplication rate → routing loop suspected (SNR not used: not meaningful
  // for multi-hop / MQTT; duplication is still a local observation).
  if (stats && stats.total > 0 && (!ignoreMqtt || !node.heard_via_mqtt_only)) {
    const lossRate = stats.duplicates / stats.total;
    if (lossRate > 0.55) {
      return {
        nodeId: node.node_id,
        type: 'bad_route',
        severity: 'error',
        description: `${Math.round(lossRate * 100)}% packet duplication — routing loop suspected`,
        detectedAt: Date.now(),
        snr: node.snr,
        hopsAway: node.hops_away,
      };
    }
  }
  // Very close node taking many hops
  if (
    (!ignoreMqtt || !node.heard_via_mqtt_only) &&
    homeNode &&
    homeNode.latitude &&
    homeNode.longitude &&
    node.latitude &&
    node.longitude
  ) {
    const distKm = haversineDistanceKm(
      homeNode.latitude,
      homeNode.longitude,
      node.latitude,
      node.longitude,
    );
    const distMiles = distKm * 0.621371;
    const distanceOffsetMiles = distanceOffsetKm * 0.621371;
    const maxHopsCloseIn = hopsThreshold + 2; // standard 4, city 5, canyon 6
    if (
      distMiles < 5 * distanceMultiplier + distanceOffsetMiles &&
      (node.hops_away ?? 0) > maxHopsCloseIn
    ) {
      return {
        nodeId: node.node_id,
        type: 'bad_route',
        severity: 'warning',
        description: `Only ${distMiles.toFixed(1)} mi away but taking ${node.hops_away ?? '?'} hops — possible suboptimal route`,
        detectedAt: Date.now(),
        snr: node.snr,
        hopsAway: node.hops_away,
      };
    }
  }
  return null;
}

export function detectImpossibleHop(
  node: MeshNode,
  homeNode: MeshNode | null,
  ignoreMqtt = false,
): NodeAnomaly | null {
  if (ignoreMqtt && node.heard_via_mqtt_only) return null;
  if (node.hops_away !== 0) return null;
  if (!homeNode?.latitude || !homeNode?.longitude) return null;
  if (!node.latitude || !node.longitude) return null;
  const distKm = haversineDistanceKm(
    homeNode.latitude,
    homeNode.longitude,
    node.latitude,
    node.longitude,
  );
  const distMiles = distKm * 0.621371;
  if (distMiles > 100) {
    return {
      nodeId: node.node_id,
      type: 'impossible_hop',
      severity: 'error',
      description: `Reported as 0 hops away but ${Math.round(distMiles)} miles distant — GPS or routing data suspect`,
      detectedAt: Date.now(),
      snr: node.snr,
      hopsAway: 0,
    };
  }
  return null;
}

export function detectRouteFlapping(
  nodeId: number,
  hopHistory: HopHistoryPoint[],
): NodeAnomaly | null {
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const recent = hopHistory.filter((p) => p.t >= tenMinAgo);
  if (recent.length < 2) return null;
  let changes = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].h !== recent[i - 1].h) changes++;
  }
  if (changes > 3) {
    return {
      nodeId,
      type: 'route_flapping',
      severity: 'warning',
      description: `Hop count changed ${changes} times in the last 10 minutes — unstable route`,
      detectedAt: Date.now(),
    };
  }
  return null;
}

export function analyzeNode(
  node: MeshNode,
  stats: { total: number; duplicates: number } | undefined,
  homeNode: MeshNode | null,
  hopHistory: HopHistoryPoint[],
  ignoreMqtt = false,
  distanceMultiplier = 1,
  distanceOffsetKm = 0,
  hopsThreshold = 2,
  capabilities?: ProtocolCapabilities,
): NodeAnomaly | null {
  // Priority: errors first, then warnings
  // impossible_hop requires hops_away === 0 — skip for protocols without hop count
  const impossibleHop =
    capabilities?.hasHopCount === false ? null : detectImpossibleHop(node, homeNode, ignoreMqtt);
  if (impossibleHop) return impossibleHop;

  const badRoute = detectBadRoute(
    node,
    stats,
    homeNode,
    ignoreMqtt,
    distanceMultiplier,
    distanceOffsetKm,
    hopsThreshold,
  );
  if (badRoute?.severity === 'error') return badRoute;

  const flapping = detectRouteFlapping(node.node_id, hopHistory);
  if (flapping) return flapping;

  const hopGoblin = detectHopGoblin(
    node,
    homeNode,
    ignoreMqtt,
    distanceMultiplier,
    distanceOffsetKm,
    hopsThreshold,
  );
  if (hopGoblin) return hopGoblin;

  if (badRoute?.severity === 'warning') return badRoute;

  return null;
}
