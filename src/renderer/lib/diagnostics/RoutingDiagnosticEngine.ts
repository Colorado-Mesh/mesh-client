import { haversineDistanceKm } from '../nodeStatus';
import type { ProtocolCapabilities } from '../radio/BaseRadioProvider';
import type { HopHistoryPoint, MeshNode, NodeAnomaly } from '../types';
import { hopCountMeaningfulForNodeDiagnostics } from './hopCountMeaningfulForNodeDiagnostics';

export const NOISY_PORTNUMS = {
  POSITION_APP: 3,
  REMOTE_HARDWARE_APP: 2,
  NODEINFO_APP: 4,
  ADMIN_APP: 6,
  TRACEROUTE_APP: 11,
  REMOTE_HARDWARE_APP_V2: 66,
  TELEMETRY_APP: 67,
  NEIGHBOR_INFO_APP: 71,
} as const;

export interface NoiseStats {
  nodeId: number;
  /** Portnum -> count in window */
  counts: Record<number, number>;
  windowMs: number;
}

export function detectHopGoblin(
  node: MeshNode,
  homeNode: MeshNode | null,
  distanceMultiplier = 1,
  distanceOffsetKm = 0,
  hopsThreshold = 2,
): NodeAnomaly | null {
  if (!hopCountMeaningfulForNodeDiagnostics(node)) return null;

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
        descriptionI18n: {
          key: 'diagnosticsPanel.routingDesc.hopGoblinKm',
          params: { distanceKm: distKm.toFixed(2), hops: node.hops_away ?? '?' },
        },
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
        descriptionI18n: {
          key: 'diagnosticsPanel.routingDesc.badRouteDuplication',
          params: { percent: Math.round(lossRate * 100) },
        },
        detectedAt: Date.now(),
        snr: node.snr,
        hopsAway: node.hops_away,
      };
    }
  }
  // Very close node taking many hops
  if (
    hopCountMeaningfulForNodeDiagnostics(node) &&
    homeNode?.latitude != null &&
    homeNode?.longitude != null &&
    node.latitude != null &&
    node.longitude != null
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
        descriptionI18n: {
          key: 'diagnosticsPanel.routingDesc.badRouteSuboptimalMi',
          params: { distanceMi: distMiles.toFixed(1), hops: node.hops_away ?? '?' },
        },
        detectedAt: Date.now(),
        snr: node.snr,
        hopsAway: node.hops_away,
      };
    }
  }
  return null;
}

export function detectImpossibleHop(node: MeshNode, homeNode: MeshNode | null): NodeAnomaly | null {
  if (!hopCountMeaningfulForNodeDiagnostics(node)) return null;
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
      descriptionI18n: {
        key: 'diagnosticsPanel.routingDesc.impossibleHopMi',
        params: { miles: Math.round(distMiles) },
      },
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
      descriptionI18n: {
        key: 'diagnosticsPanel.routingDesc.routeFlapping',
        params: { changes },
      },
      detectedAt: Date.now(),
    };
  }
  return null;
}

/**
 * MeshCore-specific: detect path instability from PathUpdated (0x81) event count.
 * More accurate than hop-count heuristic — an actual re-route event, not an inference.
 */
export function detectPathInstability(
  nodeId: number,
  pathUpdatedTimestamps: number[],
): NodeAnomaly | null {
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const recent = pathUpdatedTimestamps.filter((t) => t >= tenMinAgo);
  if (recent.length <= 3) return null;
  return {
    nodeId,
    type: 'route_flapping',
    severity: 'warning',
    description: `Route changed ${recent.length} times in the last 10 minutes — path is unstable`,
    descriptionI18n: {
      key: 'diagnosticsPanel.routingDesc.pathInstability',
      params: { changes: recent.length },
    },
    detectedAt: Date.now(),
  };
}

/** MeshCore-specific: identify the weakest hop in a traced route using per-hop SNR data. */
export function detectWeakLinkOnPath(nodeId: number, tracePathSnrs: number[]): NodeAnomaly | null {
  if (tracePathSnrs.length < 2) return null;
  let minSnr = Infinity;
  let minHop = 0;
  for (let i = 0; i < tracePathSnrs.length; i++) {
    if (tracePathSnrs[i] < minSnr) {
      minSnr = tracePathSnrs[i];
      minHop = i + 1;
    }
  }
  if (minSnr < -5) {
    return {
      nodeId,
      type: 'weak_link',
      severity: 'warning',
      confidence: 'proven',
      description: `Weak link at hop ${minHop} (SNR ${minSnr.toFixed(1)} dB) — low-signal relay on traced path`,
      descriptionI18n: {
        key: 'diagnosticsPanel.routingDesc.weakLink',
        params: { hop: minHop, snr: minSnr.toFixed(1) },
      },
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
  noiseStats?: NoiseStats | null,
  tracePathSnrs?: number[],
  pathUpdatedTimestamps?: number[],
): NodeAnomaly | null {
  // Priority: errors first, then warnings
  // impossible_hop requires hops_away === 0 — skip for protocols without hop count
  const impossibleHop =
    capabilities?.hasHopCount === false ? null : detectImpossibleHop(node, homeNode);
  if (impossibleHop) return impossibleHop;

  const noisyNode = noiseStats ? detectNoisyNode(noiseStats) : null;
  if (noisyNode?.severity === 'error') return noisyNode;

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

  // Use PathUpdated events (MeshCore) when available; fall back to hop-count heuristic
  const flapping = hopCountMeaningfulForNodeDiagnostics(node)
    ? pathUpdatedTimestamps?.length
      ? detectPathInstability(node.node_id, pathUpdatedTimestamps)
      : detectRouteFlapping(node.node_id, hopHistory)
    : null;
  if (flapping) return flapping;

  const hopGoblin = detectHopGoblin(
    node,
    homeNode,
    distanceMultiplier,
    distanceOffsetKm,
    hopsThreshold,
  );
  if (hopGoblin) return hopGoblin;

  // MeshCore per-hop SNR weak link (only when trace data is present)
  if (capabilities?.hasPerHopSnr && tracePathSnrs?.length) {
    const weakLink = detectWeakLinkOnPath(node.node_id, tracePathSnrs);
    if (weakLink) return weakLink;
  }

  if (badRoute?.severity === 'warning') return badRoute;

  if (noisyNode) return noisyNode;

  return null;
}

/**
 * Check if a node is sending excessive traffic on noisy portnums.
 *
 * Thresholds per portnum (per hour):
 * - NodeInfo (4): warning < 4, error >= 4 (default 3h interval → 8/hour at rest)
 * - Telemetry (67): warning < 4, error >= 4 (default 15min → 4/hour)
 * - NeighborInfo (71): warning < 1, error >= 2 (should be <= 1 per few hours)
 * - Other noisy: warning < 5, error >= 10
 */
export function detectNoisyNode(
  stats: NoiseStats | null,
  warnThreshold = 5,
  errorThreshold = 10,
): NodeAnomaly | null {
  if (!stats || Object.keys(stats.counts).length === 0) return null;

  const windowHours = stats.windowMs / 3_600_000;
  const exceedPorts: number[] = [];
  const errorPorts: number[] = [];
  let maxExceed = 0;

  for (const [portnumStr, count] of Object.entries(stats.counts)) {
    const portnum = Number(portnumStr);
    const ratePerHour = count / windowHours;

    let localWarn: number;
    let localError = errorThreshold;

    if (portnum === NOISY_PORTNUMS.NODEINFO_APP) localWarn = 4;
    else if (portnum === NOISY_PORTNUMS.TELEMETRY_APP) localWarn = 4;
    else if (portnum === NOISY_PORTNUMS.POSITION_APP) localWarn = 4;
    else if (portnum === NOISY_PORTNUMS.NEIGHBOR_INFO_APP) {
      localWarn = 1;
      localError = 2;
    }
    // MeshCore: Discovery Flood > 3/hr warning, > 10/hr error
    else if (portnum === 1001) {
      localWarn = 3;
      localError = 10;
    }
    // MeshCore: Room Advert > 4/hr warning (> 4/hr = every 15min = noisy)
    else if (portnum === 1002) {
      localWarn = 4;
      localError = 10;
    } else localWarn = warnThreshold;

    if (ratePerHour >= localWarn) {
      exceedPorts.push(portnum);
      maxExceed = Math.max(maxExceed, ratePerHour);
      if (ratePerHour >= localError) errorPorts.push(portnum);
    }
  }

  if (exceedPorts.length === 0) return null;

  const portLabels = exceedPorts
    .map((p) => {
      if (p === NOISY_PORTNUMS.NODEINFO_APP) return 'NodeInfo';
      if (p === NOISY_PORTNUMS.TELEMETRY_APP) return 'Telemetry';
      if (p === NOISY_PORTNUMS.NEIGHBOR_INFO_APP) return 'NeighborInfo';
      if (p === NOISY_PORTNUMS.TRACEROUTE_APP) return 'Traceroute';
      if (p === NOISY_PORTNUMS.POSITION_APP) return 'Position';
      if (p === NOISY_PORTNUMS.REMOTE_HARDWARE_APP || p === NOISY_PORTNUMS.REMOTE_HARDWARE_APP_V2)
        return 'RemoteHardware';
      if (p === NOISY_PORTNUMS.ADMIN_APP) return 'Admin';
      // MeshCore fake portnums
      if (p === 1001) return 'DiscoveryFlood';
      if (p === 1002) return 'RoomAdvert';
      return `Port${p}`;
    })
    .join(', ');

  const isError = errorPorts.length > 0;

  return {
    nodeId: stats.nodeId,
    type: 'noisy_node',
    severity: isError ? 'error' : 'warning',
    confidence: 'proven',
    description: `Sending ${Math.round(maxExceed)}/hr on ${portLabels} — excessive traffic`,
    descriptionI18n: {
      key: 'diagnosticsPanel.routingDesc.noisyNode',
      params: { ratePerHour: Math.round(maxExceed), ports: portLabels },
    },
    detectedAt: Date.now(),
  };
}
