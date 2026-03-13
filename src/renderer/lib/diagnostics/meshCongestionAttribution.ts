import type { NodeAnomaly } from '../types';

/** Minimal shape to avoid importing diagnosticsStore (runtime) from lib. */
export interface PacketRecordLike {
  paths: { transport: 'rf' | 'mqtt' }[];
}

export interface RfDuplicateOriginator {
  nodeId: number;
  /** Extra RF receptions beyond first (sum of paths.length - 1 per record) */
  echoScore: number;
  /** Number of packet records with RF-only multi-path for this originator */
  recordCount: number;
}

function isRfOnlyMultiPath(rec: PacketRecordLike): boolean {
  if (rec.paths.length <= 1) return false;
  return rec.paths.every((p) => p.transport === 'rf');
}

/**
 * Rank originators whose packets were heard multiple times on RF only (no MQTT on those paths).
 * Does not identify which repeater relayed — only which node's traffic most often arrives duplicated at our radio.
 */
export function summarizeRfDuplicateOriginators(
  packetCache: Map<number, PacketRecordLike & { fromNodeId: number }>,
  limit = 5,
): RfDuplicateOriginator[] {
  const byNode = new Map<number, { echoScore: number; recordCount: number }>();
  for (const rec of packetCache.values()) {
    if (!isRfOnlyMultiPath(rec)) continue;
    const extra = rec.paths.length - 1;
    const prev = byNode.get(rec.fromNodeId) ?? { echoScore: 0, recordCount: 0 };
    byNode.set(rec.fromNodeId, {
      echoScore: prev.echoScore + extra,
      recordCount: prev.recordCount + 1,
    });
  }
  return [...byNode.entries()]
    .map(([nodeId, v]) => ({ nodeId, ...v }))
    .filter((e) => e.echoScore > 0)
    .sort((a, b) => b.echoScore - a.echoScore)
    .slice(0, limit);
}

const MIN_ECHO_PACKETS = 5;
const MQTT_HEAVY_RATIO = 0.6;
const MQTT_CAUSAL_RATIO = 0.75;

export interface MeshCongestionAttribution {
  /** Enough multi-path packets to say anything specific */
  sufficientEvidence: boolean;
  /** 0–1 fraction of multi-path packets that include at least one MQTT path */
  mqttInvolvedRatio: number;
  /** True when mqttInvolvedRatio >= MQTT_HEAVY_RATIO */
  mqttHeavy: boolean;
  /** True when mqttInvolvedRatio >= MQTT_CAUSAL_RATIO — copy can say "often involves MQTT" */
  mqttCausal: boolean;
  /** Count of packet records with paths.length > 1 */
  multiPathCount: number;
  /** Whether any routing anomaly exists (bad_route / hop_goblin) */
  hasRoutingAnomalies: boolean;
}

function recordInvolvesMqtt(rec: PacketRecordLike): boolean {
  return rec.paths.some((p) => p.transport === 'mqtt');
}

/** True when any anomaly is bad_route or hop_goblin (mesh-wide routing stress). */
export function meshHasRoutingAnomalies(anomalies: Map<number, NodeAnomaly>): boolean {
  for (const a of anomalies.values()) {
    if (a.type === 'bad_route' || a.type === 'hop_goblin') return true;
  }
  return false;
}

/** Single line when mesh has routing anomalies — use with meshHasRoutingAnomalies. */
export const MESH_ROUTING_ANOMALY_LINE =
  'This mesh currently has routing anomalies (long routes close in) — that increases duplicate receptions until routes improve.';

/**
 * Summarize packetCache for Mesh Congestion detail copy. Only uses packetId/path
 * structure — no user-controlled strings in output templates.
 */
export function summarizeMeshCongestionAttribution(
  packetCache: Map<number, PacketRecordLike>,
  anomalies: Map<number, NodeAnomaly>,
): MeshCongestionAttribution {
  let multiPathCount = 0;
  let mqttInvolved = 0;
  for (const rec of packetCache.values()) {
    if (rec.paths.length <= 1) continue;
    multiPathCount++;
    if (recordInvolvesMqtt(rec)) mqttInvolved++;
  }
  const sufficientEvidence = multiPathCount >= MIN_ECHO_PACKETS;
  const mqttInvolvedRatio = multiPathCount > 0 ? mqttInvolved / multiPathCount : 0;
  const hasRoutingAnomalies = meshHasRoutingAnomalies(anomalies);
  return {
    sufficientEvidence,
    mqttInvolvedRatio,
    mqttHeavy: sufficientEvidence && mqttInvolvedRatio >= MQTT_HEAVY_RATIO,
    mqttCausal: sufficientEvidence && mqttInvolvedRatio >= MQTT_CAUSAL_RATIO,
    multiPathCount,
    hasRoutingAnomalies,
  };
}

/**
 * Single-line answer when we have any multi-path data but not enough for full confidence.
 */
export function meshCongestionPartialAnswer(attr: MeshCongestionAttribution): string | null {
  if (attr.sufficientEvidence || attr.multiPathCount === 0) return null;
  const pct = Math.round(attr.mqttInvolvedRatio * 100);
  return `So far, ${attr.multiPathCount} duplicate packet(s) had multiple paths; ${pct}% involved MQTT — need a few more samples to confirm the main cause. If you use a gateway with MQTT downlink, try Ignore MQTT for that node in Diagnostics to see if duplicates drop.`;
}

export interface MeshCongestionDetailLinesOptions {
  /** When true, append routing anomaly line even if multi-path evidence is insufficient. */
  alwaysIncludeRoutingAnomalies?: boolean;
}

/** Template-only detail lines for UI (no raw node names). */
export function meshCongestionDetailLines(
  attr: MeshCongestionAttribution,
  options?: MeshCongestionDetailLinesOptions,
): string[] {
  const lines: string[] = [];
  if (!attr.sufficientEvidence) {
    const partial = meshCongestionPartialAnswer(attr);
    if (partial) {
      lines.push(partial);
    } else {
      lines.push(
        'Duplicates are likely from overlapping RF coverage, MQTT+RF double delivery if you use a gateway, or repeaters with a high hop limit — we have not logged enough multi-path packets yet to say which dominates.',
      );
    }
    if (options?.alwaysIncludeRoutingAnomalies && attr.hasRoutingAnomalies) {
      lines.push(MESH_ROUTING_ANOMALY_LINE);
    }
    return lines;
  }
  const pct = Math.round(attr.mqttInvolvedRatio * 100);
  if (attr.mqttCausal) {
    lines.push(
      `Path mix: ${pct}% of recent multi-path packets involved MQTT — check gateway downlink overlap or Ignore MQTT for bridged nodes.`,
    );
  } else if (attr.mqttHeavy) {
    lines.push(
      `Path mix: ${pct}% of recent multi-path packets often involve MQTT — overlapping RF+MQTT may duplicate deliveries.`,
    );
  } else {
    lines.push(
      `Path mix: ${pct}% of recent multi-path packets are RF-only (no MQTT on those paths) — overlapping RF coverage or repeaters with a high hop limit are the likely cause; reducing hop limit on strong local nodes usually helps.`,
    );
  }
  if (attr.hasRoutingAnomalies) {
    lines.push(MESH_ROUTING_ANOMALY_LINE);
  }
  return lines;
}
