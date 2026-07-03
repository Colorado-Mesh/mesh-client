import type {
  DiagnosticRow,
  MeshProtocol,
  NodeAnomaly,
  RfDiagnosticRow,
  RoutingDiagnosticRow,
} from '../types';
import { nodeAnomalyToRoutingRow, rfRowId, routingRowToNodeAnomaly } from '../types';
import { isReticulumDiagnosticRow } from './ReticulumDiagnosticEngine';
import type { RFDiagnosis } from './RFDiagnosticEngine';

/** Foreign LoRa RF row conditions — preserved when replacing telemetry-driven RF rows per node. */
export const FOREIGN_LORA_RF_CONDITIONS = new Set([
  'MeshCore Activity Detected',
  'Meshtastic Traffic Detected',
  'Reticulum Traffic Detected',
  'Unknown LoRa Traffic',
  'Potential MeshCore Repeater Conflict',
]);

/** Align with hop/CU history windows in diagnosticsStore. */
export const DEFAULT_ROUTING_DIAGNOSTIC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** RF findings are telemetry snapshots — shorter TTL reduces stale Mesh Congestion etc. */
export const DEFAULT_RF_DIAGNOSTIC_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Scope diagnostic rows to the active protocol tab.
 * - Reticulum tab: only `reticulum/*` native rows (interface/LXMF audit).
 * - Meshtastic/MeshCore tabs: LoRa routing/RF rows only (no `reticulum/*`).
 * LoRa rows are also cleared on protocol switch; `runReanalysis` uses the active tab's node map.
 * Foreign LoRa overhear tables are Meshtastic-tab-only (see DiagnosticsPanel).
 */
export function filterDiagnosticRowsForProtocol(
  rows: DiagnosticRow[],
  protocol: MeshProtocol,
): DiagnosticRow[] {
  if (protocol === 'reticulum') {
    return rows.filter((r) => isReticulumDiagnosticRow(r));
  }
  return rows.filter((r) => !isReticulumDiagnosticRow(r));
}

/**
 * Drop rows whose detectedAt is older than max age. Routing rows refresh detectedAt on each
 * analyzeNode; if a node goes quiet the row ages out. RF uses rfMaxAgeMs when provided.
 */
export function pruneDiagnosticRowsByAge(
  rows: DiagnosticRow[],
  now: number,
  routingMaxAgeMs: number,
  rfMaxAgeMs?: number,
): DiagnosticRow[] {
  const rfLimit = rfMaxAgeMs ?? routingMaxAgeMs;
  return rows.filter((r) => {
    const limit = r.kind === 'rf' ? rfLimit : routingMaxAgeMs;
    return now - r.detectedAt < limit;
  });
}

/** Build Map of routing anomalies only (for meshCongestionAttribution, legacy APIs). */
export function diagnosticRowsToRoutingMap(rows: DiagnosticRow[]): Map<number, NodeAnomaly> {
  const m = new Map<number, NodeAnomaly>();
  for (const r of rows) {
    if (r.kind === 'routing') m.set(r.nodeId, routingRowToNodeAnomaly(r));
  }
  return m;
}

/** Node IDs that have a routing anomaly (for map include list). */
export function routingAnomalyNodeIds(rows: DiagnosticRow[]): Set<number> {
  const s = new Set<number>();
  for (const r of rows) {
    if (r.kind === 'routing') s.add(r.nodeId);
  }
  return s;
}

export function getRoutingRowForNode(
  rows: DiagnosticRow[],
  nodeId: number,
): RoutingDiagnosticRow | null {
  for (const r of rows) {
    if (r.kind === 'routing' && r.nodeId === nodeId) return r;
  }
  return null;
}

export function meshHasRoutingAnomaliesFromRows(rows: DiagnosticRow[]): boolean {
  for (const r of rows) {
    if (r.kind === 'routing' && (r.type === 'bad_route' || r.type === 'hop_goblin')) {
      return true;
    }
  }
  return false;
}

export function rfDiagnosesToRows(nodeId: number, findings: RFDiagnosis[]): RfDiagnosticRow[] {
  const now = Date.now();
  return findings.map((f) => ({
    kind: 'rf' as const,
    id: rfRowId(nodeId, f.condition),
    nodeId,
    condition: f.condition,
    cause: f.cause,
    severity: f.severity,
    detectedAt: now,
    isLastHop: f.isLastHop,
    causeI18n: f.causeI18n,
  }));
}

/** Replace all routing rows with map contents; keep RF rows. */
export function replaceRoutingRowsFromMap(
  current: DiagnosticRow[],
  routingMap: Map<number, NodeAnomaly>,
): DiagnosticRow[] {
  const rfOnly = current.filter((r): r is RfDiagnosticRow => r.kind === 'rf');
  const routingRows: RoutingDiagnosticRow[] = [];
  for (const a of routingMap.values()) {
    routingRows.push(nodeAnomalyToRoutingRow(a));
  }
  return [...routingRows, ...rfOnly];
}

/**
 * Remove telemetry-driven RF rows for nodeId, preserve Foreign LoRa rows for that node, then append new findings.
 */
export function replaceRfRowsForNode(
  current: DiagnosticRow[],
  nodeId: number,
  findings: RFDiagnosis[],
): DiagnosticRow[] {
  const withoutRf = current.filter(
    (r) => r.kind !== 'rf' || r.nodeId !== nodeId || FOREIGN_LORA_RF_CONDITIONS.has(r.condition),
  );
  return [...withoutRf, ...rfDiagnosesToRows(nodeId, findings)];
}
