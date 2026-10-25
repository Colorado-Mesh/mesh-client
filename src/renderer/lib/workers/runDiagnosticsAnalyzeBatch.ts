import type { ProtocolCapabilities } from '../radio/BaseRadioProvider';
import type { MeshNode, NodeAnomaly } from '../types';
import type { DiagnosticsAnalyzeNodeInput } from './analysisJobTypes';
import {
  nextAnalysisSequence,
  runAnalysisRequest,
  runAnalysisRequestInline,
} from './analysisWorkerPool';

export interface DiagnosticsAnalyzeBatchArgs {
  homeNode: MeshNode | null;
  distanceMultiplier: number;
  distanceOffsetKm: number;
  hopsThreshold: number;
  capabilities?: Pick<
    ProtocolCapabilities,
    'hasHopCount' | 'hasDistanceBasedHopAnomalies' | 'hasPerHopSnr' | 'protocol'
  >;
  nodes: DiagnosticsAnalyzeNodeInput[];
}

function toRequest(args: DiagnosticsAnalyzeBatchArgs, sequence: number) {
  return {
    kind: 'diagnosticsAnalyzeBatch' as const,
    sequence,
    homeNode: args.homeNode,
    distanceMultiplier: args.distanceMultiplier,
    distanceOffsetKm: args.distanceOffsetKm,
    hopsThreshold: args.hopsThreshold,
    capabilities: args.capabilities
      ? {
          protocol: args.capabilities.protocol,
          hasHopCount: args.capabilities.hasHopCount,
          hasDistanceBasedHopAnomalies: args.capabilities.hasDistanceBasedHopAnomalies,
          hasPerHopSnr: args.capabilities.hasPerHopSnr,
        }
      : undefined,
    nodes: args.nodes,
  };
}

export async function runDiagnosticsAnalyzeBatch(args: DiagnosticsAnalyzeBatchArgs): Promise<{
  anomalies: Map<number, NodeAnomaly>;
  clearedNodeIds: number[];
}> {
  const result = await runAnalysisRequest(toRequest(args, nextAnalysisSequence()));
  if (result.kind !== 'diagnosticsAnalyzeBatch') {
    throw new Error(`unexpected analysis result ${result.kind}`);
  }
  const anomalies = new Map<number, NodeAnomaly>();
  for (const row of result.anomalies) {
    anomalies.set(row.nodeId, row.anomaly);
  }
  return { anomalies, clearedNodeIds: result.clearedNodeIds };
}

export function runDiagnosticsAnalyzeBatchInline(args: DiagnosticsAnalyzeBatchArgs): {
  anomalies: Map<number, NodeAnomaly>;
  clearedNodeIds: number[];
} {
  const result = runAnalysisRequestInline(toRequest(args, nextAnalysisSequence()));
  if (result.kind !== 'diagnosticsAnalyzeBatch') {
    throw new Error(`unexpected analysis result ${result.kind}`);
  }
  const anomalies = new Map<number, NodeAnomaly>();
  for (const row of result.anomalies) {
    anomalies.set(row.nodeId, row.anomaly);
  }
  return { anomalies, clearedNodeIds: result.clearedNodeIds };
}
