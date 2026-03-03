import { haversineDistanceKm } from "../nodeStatus";
import type { MeshNode, NodeAnomaly, HopHistoryPoint } from "../types";

export function detectHopGoblin(node: MeshNode, homeNode: MeshNode | null, ignoreMqtt = false): NodeAnomaly | null {
  if (ignoreMqtt && node.heard_via_mqtt_only) return null;

  // Distance-aware: if both nodes have GPS coords, use haversine
  if (
    homeNode?.latitude && homeNode?.longitude &&
    node.latitude && node.longitude
  ) {
    const distKm = haversineDistanceKm(
      homeNode.latitude, homeNode.longitude,
      node.latitude, node.longitude
    );
    if (distKm < 3 && (node.hops_away ?? 0) > 2) {
      return {
        nodeId: node.node_id,
        type: "hop_goblin",
        severity: "error",
        description: `Only ${distKm.toFixed(2)} km away but taking ${node.hops_away} hops — critical over-hopping`,
        detectedAt: Date.now(),
        snr: node.snr,
        hopsAway: node.hops_away,
      };
    }
    // Coords present but node isn't critically close — still check SNR
    if ((node.hops_away ?? 0) > 2 && node.snr > 5) {
      return {
        nodeId: node.node_id,
        type: "hop_goblin",
        severity: "warning",
        description: `${node.hops_away} hops away but strong signal (${node.snr.toFixed(1)} dB) — may be over-hopping`,
        detectedAt: Date.now(),
        snr: node.snr,
        hopsAway: node.hops_away,
      };
    }
    return null;
  }

  // Fallback: SNR-only when coordinates are missing
  if ((node.hops_away ?? 0) > 2 && node.snr > 5) {
    return {
      nodeId: node.node_id,
      type: "hop_goblin",
      severity: "warning",
      description: `${node.hops_away} hops away but strong signal (${node.snr.toFixed(1)} dB) — may be over-hopping (no GPS for distance check)`,
      detectedAt: Date.now(),
      snr: node.snr,
      hopsAway: node.hops_away,
    };
  }
  return null;
}

export function detectBadRoute(
  node: MeshNode,
  stats: { total: number; duplicates: number } | undefined,
  homeNode: MeshNode | null,
  ignoreMqtt = false
): NodeAnomaly | null {
  // High duplication rate with good signal = routing loop
  if (stats && stats.total > 0) {
    const lossRate = stats.duplicates / stats.total;
    if (lossRate > 0.4 && node.snr > 5) {
      return {
        nodeId: node.node_id,
        type: "bad_route",
        severity: "error",
        description: `${Math.round(lossRate * 100)}% packet duplication with strong signal — routing loop suspected`,
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
      node.longitude
    );
    const distMiles = distKm * 0.621371;
    if (distMiles < 5 && (node.hops_away ?? 0) > 4) {
      return {
        nodeId: node.node_id,
        type: "bad_route",
        severity: "warning",
        description: `Only ${distMiles.toFixed(1)} mi away but taking ${node.hops_away} hops — possible suboptimal route`,
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
  ignoreMqtt = false
): NodeAnomaly | null {
  if (ignoreMqtt && node.heard_via_mqtt_only) return null;
  if (node.hops_away !== 0) return null;
  if (!homeNode?.latitude || !homeNode?.longitude) return null;
  if (!node.latitude || !node.longitude) return null;
  const distKm = haversineDistanceKm(
    homeNode.latitude,
    homeNode.longitude,
    node.latitude,
    node.longitude
  );
  const distMiles = distKm * 0.621371;
  if (distMiles > 100) {
    return {
      nodeId: node.node_id,
      type: "impossible_hop",
      severity: "error",
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
  hopHistory: HopHistoryPoint[]
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
      type: "route_flapping",
      severity: "warning",
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
  ignoreMqtt = false
): NodeAnomaly | null {
  // Priority: errors first, then warnings
  const impossibleHop = detectImpossibleHop(node, homeNode, ignoreMqtt);
  if (impossibleHop) return impossibleHop;

  const badRoute = detectBadRoute(node, stats, homeNode, ignoreMqtt);
  if (badRoute?.severity === "error") return badRoute;

  const flapping = detectRouteFlapping(node.node_id, hopHistory);
  if (flapping) return flapping;

  const hopGoblin = detectHopGoblin(node, homeNode, ignoreMqtt);
  if (hopGoblin) return hopGoblin;

  if (badRoute?.severity === "warning") return badRoute;

  return null;
}

export function computeHealthScore(
  totalNodes: number,
  anomalies: Map<number, NodeAnomaly>
): number {
  if (totalNodes === 0) return 100;
  let errorCount = 0;
  let warningCount = 0;
  for (const anomaly of anomalies.values()) {
    if (anomaly.severity === "error") errorCount++;
    else warningCount++;
  }
  const score = 100 - ((errorCount * 2 + warningCount) / totalNodes) * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}
