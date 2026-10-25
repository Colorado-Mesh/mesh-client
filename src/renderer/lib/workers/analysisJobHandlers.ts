import { analyzeNode } from '../diagnostics/RoutingDiagnosticEngine';
import type { ProtocolCapabilities } from '../radio/BaseRadioProvider';
import { buildReticulumMeshTopologyGraph } from '../reticulum/buildReticulumTopologyLayout';
import type {
  AnalysisJobRequest,
  AnalysisJobResult,
  DiagnosticsAnalyzeBatchRequest,
  TopologyBuildJobRequest,
} from './analysisJobTypes';

export function runTopologyBuildJob(request: TopologyBuildJobRequest): AnalysisJobResult {
  const graph = buildReticulumMeshTopologyGraph(request.interfaces, request.peers, {
    ...request.opts,
    serverPeerHashes: new Set(request.opts.serverPeerHashes ?? []),
  });
  return { kind: 'topologyBuild', sequence: request.sequence, graph };
}

export function runDiagnosticsAnalyzeBatchJob(
  request: DiagnosticsAnalyzeBatchRequest,
): AnalysisJobResult {
  const anomalies: { nodeId: number; anomaly: NonNullable<ReturnType<typeof analyzeNode>> }[] = [];
  const clearedNodeIds: number[] = [];
  for (const row of request.nodes) {
    const anomaly = analyzeNode(
      row.node,
      row.stats,
      request.homeNode,
      row.hopHistory,
      row.ignoreMqtt,
      request.distanceMultiplier,
      request.distanceOffsetKm,
      request.hopsThreshold,
      request.capabilities as ProtocolCapabilities | undefined,
      row.noiseStats,
      row.tracePathSnrs,
      row.pathUpdatedTimestamps,
    );
    if (anomaly) anomalies.push({ nodeId: row.nodeId, anomaly });
    else clearedNodeIds.push(row.nodeId);
  }
  return {
    kind: 'diagnosticsAnalyzeBatch',
    sequence: request.sequence,
    anomalies,
    clearedNodeIds,
  };
}

export function runAnalysisJob(request: AnalysisJobRequest): AnalysisJobResult {
  switch (request.kind) {
    case 'topologyBuild':
      return runTopologyBuildJob(request);
    case 'diagnosticsAnalyzeBatch':
      return runDiagnosticsAnalyzeBatchJob(request);
    default: {
      const _exhaustive: never = request;
      throw new Error(`unknown analysis job ${String(_exhaustive)}`);
    }
  }
}
