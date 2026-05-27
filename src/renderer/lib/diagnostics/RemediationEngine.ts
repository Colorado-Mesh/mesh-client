import { haversineDistanceKm } from '../nodeStatus';
import type { DiagnosticRemedy } from '../types';
import type { NodeRecord } from '../../stores/nodeStore';
import { snrMeaningfulForNodeDiagnostics } from './snrMeaningfulForNodeDiagnostics';

type ScenarioChecker = (
  node: NodeRecord,
  homeNode: NodeRecord | null,
  distMiles: number | null,
  duplicateRate: number | null,
) => DiagnosticRemedy | null;

const SCENARIOS: ScenarioChecker[] = [
  // Scenario C: Antenna/Polarization Mismatch (most specific — check first)
  (node, _home, distMiles) => {
    if (!snrMeaningfulForNodeDiagnostics(node)) return null;
    if (distMiles === null || distMiles >= 1) return null;
    if ((node.hopsAway ?? 0) <= 2) return null;
    if ((node.snr ?? 0) >= -5) return null;
    return {
      title: 'Check Antenna: Verify LOS and Polarization',
      description: `Node is <1 mi away but SNR ${(node.snr ?? 0).toFixed(1)} dB — likely antenna null or polarization mismatch.`,
      category: 'Hardware',
      severity: 'warning',
    };
  },
  // Scenario D: MQTT Ghost (0 hops but far away)
  (node, _home, distMiles) => {
    if ((node.hopsAway ?? -1) !== 0) return null;
    if (distMiles === null || distMiles <= 20) return null;
    return {
      title: "MQTT Detected: Toggle 'Ignore MQTT' for this ID",
      description: `Node appears as 0 hops but is ${distMiles.toFixed(0)} mi away — likely bridged via MQTT, not RF.`,
      category: 'Software',
      severity: 'info',
    };
  },
  // Scenario A: High-Ground Config (chatty node)
  (node, _home, distMiles) => {
    if (!snrMeaningfulForNodeDiagnostics(node)) return null;
    if ((node.snr ?? 0) <= 8) return null;
    if ((node.hopsAway ?? 0) < 3) return null;
    if (distMiles === null || distMiles >= 10) return null;
    return {
      title: 'Notify Op: Reduce Hop Limit to 3',
      description: `SNR ${(node.snr ?? 0).toFixed(1)} dB + ${node.hopsAway ?? '?'} hops within 10 mi — node likely has hop limit set too high.`,
      category: 'Configuration',
      severity: 'info',
    };
  },
  // Scenario B2: High duplication — suggest MQTT/RF overlap when mid-band (before B severity)
  (_node, _home, distMiles, duplicateRate) => {
    if (duplicateRate === null || duplicateRate < 0.35 || duplicateRate >= 0.5) return null;
    if (distMiles === null || distMiles >= 5) return null;
    return {
      title: 'Check MQTT / RF overlap',
      description: `${Math.round(duplicateRate * 100)}% packet duplication within 5 mi — gateway downlink or bridged paths may echo RF; try Ignore MQTT for affected nodes.`,
      category: 'Software',
      severity: 'warning',
    };
  },
  // Scenario B: RF Noise / Hidden Terminal (duplication-only; SNR not reliable multi-hop/MQTT)
  (node, _home, distMiles, duplicateRate) => {
    if (duplicateRate === null || duplicateRate < 0.5) return null;
    if (distMiles === null || distMiles >= 5) return null;
    return {
      title: 'Check Placement: Move away from electronics/noise',
      description: `${Math.round(duplicateRate * 100)}% packet duplication within 5 mi — local RF interference suspected.`,
      category: 'Physical',
      severity: 'warning',
    };
  },
];

export function getRecommendedAction(
  node: NodeRecord,
  homeNode: NodeRecord | null,
  packetStats: { total: number; duplicates: number } | undefined,
): DiagnosticRemedy | null {
  const distMiles =
    homeNode?.latitude && homeNode?.longitude && node.latitude && node.longitude
      ? haversineDistanceKm(homeNode.latitude, homeNode.longitude, node.latitude, node.longitude) *
        0.621371
      : null;

  const duplicateRate =
    packetStats && packetStats.total > 0 ? packetStats.duplicates / packetStats.total : null;

  for (const check of SCENARIOS) {
    const result = check(node, homeNode, distMiles, duplicateRate);
    if (result) return result;
  }
  return null;
}

const RF_CONDITION_REMEDIES: Record<string, DiagnosticRemedy> = {
  'Utilization vs. TX': {
    title: 'Reduce local noise / hop limit',
    description:
      'High channel utilization with low TX suggests a busy channel — reduce hop limit on nearby repeaters or relocate away from interference.',
    category: 'Configuration',
    severity: 'warning',
  },
  'Non-LoRa Noise / RFI': {
    title: 'Locate non-LoRa interference',
    description:
      'Identify motors, monitors, or power electronics near the antenna; relocate antenna or source.',
    category: 'Physical',
    severity: 'warning',
  },
  '900MHz Industrial Interference': {
    title: 'Avoid bursty 900MHz sources',
    description:
      'Smart meters and industrial telemetry can spike the channel — antenna placement and shielding help.',
    category: 'Physical',
    severity: 'warning',
  },
  'Channel Utilization Spike': {
    title: 'Check for surge in traffic or interference',
    description:
      'CU is well above recent average — temporary congestion or new interference; monitor and adjust hop limits if sustained.',
    category: 'Configuration',
    severity: 'warning',
  },
  'Mesh Congestion': {
    title: 'Reduce hop limit / check MQTT overlap',
    description:
      'High duplicate rate — see Diagnostics duplicate-traffic block; try Ignore MQTT for bridged nodes.',
    category: 'Software',
    severity: 'warning',
  },
  'Hidden Terminal Risk': {
    title: 'Improve geometry or reduce concurrency',
    description:
      'Concurrent transmitters may not hear each other — fewer hops, better placement, or fewer simultaneous talkers.',
    category: 'Physical',
    severity: 'warning',
  },
  'LoRa Collision or Corruption': {
    title: 'Filter band / relocate',
    description:
      'Non-Meshtastic LoRa or collisions — directional antenna or channel planning may help.',
    category: 'Hardware',
    severity: 'warning',
  },
  'External Interference': {
    title: 'Identify dominant transmitter',
    description:
      'Another transmitter is backing off your node — find and mitigate the source or relocate.',
    category: 'Physical',
    severity: 'warning',
  },
  'Wideband Noise Floor': {
    title: 'Reduce broadband noise sources',
    description:
      'Faulty electronics and power-line noise raise the floor — isolate antenna from noise sources.',
    category: 'Physical',
    severity: 'warning',
  },
  'Fringe / Weak Coverage': {
    title: 'Improve path or add relay',
    description: 'Node is at edge of coverage — relay placement or antenna upgrade.',
    category: 'Configuration',
    severity: 'info',
  },
};

export function getRecommendedActionForRfCondition(condition: string): DiagnosticRemedy | null {
  return RF_CONDITION_REMEDIES[condition] ?? null;
}
