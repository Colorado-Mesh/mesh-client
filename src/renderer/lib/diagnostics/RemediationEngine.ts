import { haversineDistanceKm } from "../nodeStatus";
import type { MeshNode, DiagnosticRemedy } from "../types";

type ScenarioChecker = (
  node: MeshNode,
  homeNode: MeshNode | null,
  distMiles: number | null,
  duplicateRate: number | null
) => DiagnosticRemedy | null;

const SCENARIOS: ScenarioChecker[] = [
  // Scenario C: Antenna/Polarization Mismatch (most specific — check first)
  (node, _home, distMiles) => {
    if (distMiles === null || distMiles >= 1) return null;
    if ((node.hops_away ?? 0) <= 2) return null;
    if (node.snr >= -5) return null;
    return {
      title: "Check Antenna: Verify LOS and Polarization",
      description: `Node is <1 mi away but SNR ${node.snr.toFixed(1)} dB — likely antenna null or polarization mismatch.`,
      category: "Hardware",
      severity: "warning",
    };
  },
  // Scenario D: MQTT Ghost (0 hops but far away)
  (node, _home, distMiles) => {
    if ((node.hops_away ?? -1) !== 0) return null;
    if (distMiles === null || distMiles <= 20) return null;
    return {
      title: "MQTT Detected: Toggle 'Ignore MQTT' for this ID",
      description: `Node appears as 0 hops but is ${distMiles.toFixed(0)} mi away — likely bridged via MQTT, not RF.`,
      category: "Software",
      severity: "info",
    };
  },
  // Scenario A: High-Ground Config (chatty node)
  (node, _home, distMiles) => {
    if (node.snr <= 8) return null;
    if ((node.hops_away ?? 0) < 3) return null;
    if (distMiles === null || distMiles >= 10) return null;
    return {
      title: "Notify Op: Reduce Hop Limit to 3",
      description: `SNR ${node.snr.toFixed(1)} dB + ${node.hops_away} hops within 10 mi — node likely has hop limit set too high.`,
      category: "Configuration",
      severity: "info",
    };
  },
  // Scenario B: RF Noise / Hidden Terminal
  (node, _home, distMiles, duplicateRate) => {
    if (node.snr <= 0) return null;
    if (duplicateRate === null || duplicateRate < 0.5) return null;
    if (distMiles === null || distMiles >= 5) return null;
    return {
      title: "Check Placement: Move away from electronics/noise",
      description: `${Math.round(duplicateRate * 100)}% packet duplication within 5 mi — local RF interference suspected.`,
      category: "Physical",
      severity: "warning",
    };
  },
];

export function getRecommendedAction(
  node: MeshNode,
  homeNode: MeshNode | null,
  packetStats: { total: number; duplicates: number } | undefined
): DiagnosticRemedy | null {
  const distMiles =
    homeNode?.latitude && homeNode?.longitude && node.latitude && node.longitude
      ? haversineDistanceKm(homeNode.latitude, homeNode.longitude, node.latitude, node.longitude) * 0.621371
      : null;

  const duplicateRate =
    packetStats && packetStats.total > 0
      ? packetStats.duplicates / packetStats.total
      : null;

  for (const check of SCENARIOS) {
    const result = check(node, homeNode, distMiles, duplicateRate);
    if (result) return result;
  }
  return null;
}
