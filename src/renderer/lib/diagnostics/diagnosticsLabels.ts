import type { TFunction } from 'i18next';

import type {
  AnomalyType,
  DiagnosticRemedy,
  DiagnosticTextI18n,
  RfDiagnosticRow,
  RoutingDiagnosticRow,
} from '../types';

const RF_CONDITION_LABEL_KEY: Record<string, string> = {
  'Utilization vs. TX': 'diagnosticsPanel.rfCondition.utilizationVsTx',
  'Non-LoRa Noise / RFI': 'diagnosticsPanel.rfCondition.nonLoraNoiseRfi',
  '900MHz Industrial Interference': 'diagnosticsPanel.rfCondition.industrial900mhz',
  'Channel Utilization Spike': 'diagnosticsPanel.rfCondition.channelUtilizationSpike',
  'Mesh Congestion': 'diagnosticsPanel.rfCondition.meshCongestion',
  'Hidden Terminal Risk': 'diagnosticsPanel.rfCondition.hiddenTerminalRisk',
  'LoRa Collision or Corruption': 'diagnosticsPanel.rfCondition.loraCollisionCorruption',
  'External Interference': 'diagnosticsPanel.rfCondition.externalInterference',
  'Wideband Noise Floor': 'diagnosticsPanel.rfCondition.widebandNoiseFloor',
  'Fringe / Weak Coverage': 'diagnosticsPanel.rfCondition.fringeWeakCoverage',
  'MeshCore Activity Detected': 'diagnosticsPanel.rfCondition.meshcoreActivityDetected',
  'Meshtastic Traffic Detected': 'diagnosticsPanel.rfCondition.meshtasticTrafficDetected',
  'Unknown LoRa Traffic': 'diagnosticsPanel.rfCondition.unknownLoraTraffic',
  'Potential MeshCore Repeater Conflict':
    'diagnosticsPanel.rfCondition.potentialMeshcoreRepeaterConflict',
  'Elevated Noise Floor': 'diagnosticsPanel.rfCondition.elevatedNoiseFloor',
  'Excessive Flooding': 'diagnosticsPanel.rfCondition.excessiveFlooding',
};

const ROUTING_ANOMALY_TYPE_KEY: Record<AnomalyType, string> = {
  hop_goblin: 'diagnosticsPanel.routingAnomalyType.hopGoblin',
  bad_route: 'diagnosticsPanel.routingAnomalyType.badRoute',
  route_flapping: 'diagnosticsPanel.routingAnomalyType.routeFlapping',
  impossible_hop: 'diagnosticsPanel.routingAnomalyType.impossibleHop',
  noisy_node: 'diagnosticsPanel.routingAnomalyType.noisyNode',
  weak_link: 'diagnosticsPanel.routingAnomalyType.weakLink',
};

export function translateRfConditionLabel(t: TFunction, condition: string): string {
  const key = RF_CONDITION_LABEL_KEY[condition];
  return key ? t(key) : condition;
}

export function translateRoutingAnomalyType(t: TFunction, type: AnomalyType): string {
  return t(ROUTING_ANOMALY_TYPE_KEY[type]);
}

function translateCauseI18n(t: TFunction, cause: string, causeI18n?: DiagnosticTextI18n): string {
  if (!causeI18n) return cause;
  const { key, params } = causeI18n;
  if (
    key === 'diagnosticsPanel.foreignLoraCause.meshtastic' &&
    params &&
    typeof params.proximityKey === 'string'
  ) {
    const pk = params.proximityKey;
    const proximity =
      pk === '' ? '' : `${t(`diagnosticsPanel.foreignLoraProximitySnippet.${pk}`)}. `;
    return t(key, { sender: params.sender, proximity });
  }
  return t(key, params ?? {});
}

export function translateRfCauseText(t: TFunction, row: RfDiagnosticRow): string {
  return translateCauseI18n(t, row.cause, row.causeI18n);
}

/** RF findings in {@link NodeInfoBody} use the same `causeI18n` shape as {@link RfDiagnosticRow}. */
export function translateRFDiagnosisCause(
  t: TFunction,
  cause: string,
  causeI18n?: DiagnosticTextI18n,
): string {
  return translateCauseI18n(t, cause, causeI18n);
}

export function translateRoutingRowDescription(t: TFunction, row: RoutingDiagnosticRow): string {
  if (row.descriptionI18n) {
    return t(row.descriptionI18n.key, row.descriptionI18n.params);
  }
  return row.description;
}

export function translateRemedyTitle(t: TFunction, remedy: DiagnosticRemedy): string {
  if (remedy.titleKey) return t(remedy.titleKey, remedy.titleParams);
  return remedy.title;
}

export function translateRemedyDescription(t: TFunction, remedy: DiagnosticRemedy): string {
  if (remedy.descriptionKey) {
    return t(remedy.descriptionKey, remedy.descriptionParams);
  }
  return remedy.description;
}
