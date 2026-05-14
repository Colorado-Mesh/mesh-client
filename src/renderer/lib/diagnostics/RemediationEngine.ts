import { haversineDistanceKm } from '../nodeStatus';
import type { DiagnosticRemedy, MeshNode } from '../types';
import { snrMeaningfulForNodeDiagnostics } from './snrMeaningfulForNodeDiagnostics';

type ScenarioChecker = (
  node: MeshNode,
  homeNode: MeshNode | null,
  distMiles: number | null,
  duplicateRate: number | null,
) => DiagnosticRemedy | null;

const SCENARIOS: ScenarioChecker[] = [
  // Scenario W: Weak link on traced path (MeshCore per-hop SNR)
  (node) => {
    if (!snrMeaningfulForNodeDiagnostics(node)) return null;
    if ((node.hops_away ?? 0) < 2) return null;
    if (node.snr >= -5) return null;
    return {
      title: 'Add or reposition a relay on the weak hop',
      description: `Traced path contains a hop with SNR below -5 dB — placing a relay at the midpoint could stabilize the route.`,
      category: 'Physical',
      severity: 'warning',
      titleKey: 'diagnosticsPanel.remedyScenario.weakLinkTitle',
      descriptionKey: 'diagnosticsPanel.remedyScenario.weakLinkDescription',
    };
  },
  // Scenario C: Antenna/Polarization Mismatch (most specific — check first)
  (node, _home, distMiles) => {
    if (!snrMeaningfulForNodeDiagnostics(node)) return null;
    if (distMiles === null || distMiles >= 1) return null;
    if ((node.hops_away ?? 0) <= 2) return null;
    if (node.snr >= -5) return null;
    return {
      title: 'Check Antenna: Verify LOS and Polarization',
      description: `Node is <1 mi away but SNR ${node.snr.toFixed(1)} dB — likely antenna null or polarization mismatch.`,
      category: 'Hardware',
      severity: 'warning',
      titleKey: 'diagnosticsPanel.remedyScenario.antennaPolarizationTitle',
      descriptionKey: 'diagnosticsPanel.remedyScenario.antennaPolarizationDescription',
      descriptionParams: { snr: node.snr.toFixed(1) },
    };
  },
  // Scenario D: MQTT Ghost (0 hops but far away)
  (node, _home, distMiles) => {
    if ((node.hops_away ?? -1) !== 0) return null;
    if (distMiles === null || distMiles <= 20) return null;
    return {
      title: "MQTT Detected: Toggle 'Ignore MQTT' for this ID",
      description: `Node appears as 0 hops but is ${distMiles.toFixed(0)} mi away — likely bridged via MQTT, not RF.`,
      category: 'Software',
      severity: 'info',
      titleKey: 'diagnosticsPanel.remedyScenario.mqttGhostTitle',
      descriptionKey: 'diagnosticsPanel.remedyScenario.mqttGhostDescription',
      descriptionParams: { miles: distMiles.toFixed(0) },
    };
  },
  // Scenario A: High-Ground Config (chatty node)
  (node, _home, distMiles) => {
    if (!snrMeaningfulForNodeDiagnostics(node)) return null;
    if (node.snr <= 8) return null;
    if ((node.hops_away ?? 0) < 3) return null;
    if (distMiles === null || distMiles >= 10) return null;
    return {
      title: 'Notify Op: Reduce Hop Limit to 3',
      description: `SNR ${node.snr.toFixed(1)} dB + ${node.hops_away ?? '?'} hops within 10 mi — node likely has hop limit set too high.`,
      category: 'Configuration',
      severity: 'info',
      titleKey: 'diagnosticsPanel.remedyScenario.highGroundTitle',
      descriptionKey: 'diagnosticsPanel.remedyScenario.highGroundDescription',
      descriptionParams: { snr: node.snr.toFixed(1), hops: node.hops_away ?? '?' },
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
      titleKey: 'diagnosticsPanel.remedyScenario.mqttRfOverlapTitle',
      descriptionKey: 'diagnosticsPanel.remedyScenario.mqttRfOverlapDescription',
      descriptionParams: { percent: Math.round(duplicateRate * 100) },
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
      titleKey: 'diagnosticsPanel.remedyScenario.duplicateInterferenceTitle',
      descriptionKey: 'diagnosticsPanel.remedyScenario.duplicateInterferenceDescription',
      descriptionParams: { percent: Math.round(duplicateRate * 100) },
    };
  },
];

export function getRecommendedAction(
  node: MeshNode,
  homeNode: MeshNode | null,
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
    titleKey: 'diagnosticsPanel.remedyRf.utilizationVsTx.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.utilizationVsTx.description',
  },
  'Non-LoRa Noise / RFI': {
    title: 'Locate non-LoRa interference',
    description:
      'Identify motors, monitors, or power electronics near the antenna; relocate antenna or source.',
    category: 'Physical',
    severity: 'warning',
    titleKey: 'diagnosticsPanel.remedyRf.nonLoraNoiseRfi.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.nonLoraNoiseRfi.description',
  },
  '900MHz Industrial Interference': {
    title: 'Avoid bursty 900MHz sources',
    description:
      'Smart meters and industrial telemetry can spike the channel — antenna placement and shielding help.',
    category: 'Physical',
    severity: 'warning',
    titleKey: 'diagnosticsPanel.remedyRf.industrial900mhz.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.industrial900mhz.description',
  },
  'Channel Utilization Spike': {
    title: 'Check for surge in traffic or interference',
    description:
      'CU is well above recent average — temporary congestion or new interference; monitor and adjust hop limits if sustained.',
    category: 'Configuration',
    severity: 'warning',
    titleKey: 'diagnosticsPanel.remedyRf.channelUtilizationSpike.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.channelUtilizationSpike.description',
  },
  'Mesh Congestion': {
    title: 'Reduce hop limit / check MQTT overlap',
    description:
      'High duplicate rate — see Diagnostics duplicate-traffic block; try Ignore MQTT for bridged nodes.',
    category: 'Software',
    severity: 'warning',
    titleKey: 'diagnosticsPanel.remedyRf.meshCongestion.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.meshCongestion.description',
  },
  'Hidden Terminal Risk': {
    title: 'Improve geometry or reduce concurrency',
    description:
      'Concurrent transmitters may not hear each other — fewer hops, better placement, or fewer simultaneous talkers.',
    category: 'Physical',
    severity: 'warning',
    titleKey: 'diagnosticsPanel.remedyRf.hiddenTerminalRisk.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.hiddenTerminalRisk.description',
  },
  'LoRa Collision or Corruption': {
    title: 'Filter band / relocate',
    description:
      'Non-Meshtastic LoRa or collisions — directional antenna or channel planning may help.',
    category: 'Hardware',
    severity: 'warning',
    titleKey: 'diagnosticsPanel.remedyRf.loraCollisionCorruption.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.loraCollisionCorruption.description',
  },
  'External Interference': {
    title: 'Identify dominant transmitter',
    description:
      'Another transmitter is backing off your node — find and mitigate the source or relocate.',
    category: 'Physical',
    severity: 'warning',
    titleKey: 'diagnosticsPanel.remedyRf.externalInterference.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.externalInterference.description',
  },
  'Wideband Noise Floor': {
    title: 'Reduce broadband noise sources',
    description:
      'Faulty electronics and power-line noise raise the floor — isolate antenna from noise sources.',
    category: 'Physical',
    severity: 'warning',
    titleKey: 'diagnosticsPanel.remedyRf.widebandNoiseFloor.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.widebandNoiseFloor.description',
  },
  'Fringe / Weak Coverage': {
    title: 'Improve path or add relay',
    description: 'Node is at edge of coverage — relay placement or antenna upgrade.',
    category: 'Configuration',
    severity: 'info',
    titleKey: 'diagnosticsPanel.remedyRf.fringeWeakCoverage.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.fringeWeakCoverage.description',
  },
  'Elevated Noise Floor': {
    title: 'Identify and remove interference source',
    description:
      'Elevated noise floor reduces range and SNR — check for nearby electronics, switching power supplies, or motors.',
    category: 'Physical',
    severity: 'warning',
    titleKey: 'diagnosticsPanel.remedyRf.elevatedNoiseFloor.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.elevatedNoiseFloor.description',
  },
  'Excessive Flooding': {
    title: 'Allow direct routes to establish',
    description:
      'Flood ratio is very high — wait for the node to accumulate direct-path contacts, or check repeater proximity.',
    category: 'Configuration',
    severity: 'warning',
    titleKey: 'diagnosticsPanel.remedyRf.excessiveFlooding.title',
    descriptionKey: 'diagnosticsPanel.remedyRf.excessiveFlooding.description',
  },
};

export function getRecommendedActionForRfCondition(condition: string): DiagnosticRemedy | null {
  return RF_CONDITION_REMEDIES[condition] ?? null;
}
