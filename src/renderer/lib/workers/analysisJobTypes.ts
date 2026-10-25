import type { NoiseStats } from '../diagnostics/RoutingDiagnosticEngine';
import type { ProtocolCapabilities } from '../radio/BaseRadioProvider';
import type {
  BuildReticulumMeshTopologyGraphOptions,
  ReticulumTopologyGraph,
  ReticulumTopologyInterfaceInput,
  ReticulumTopologyNodeInput,
} from '../reticulum/buildReticulumTopologyLayout';
import type { HopHistoryPoint, MeshNode, NodeAnomaly } from '../types';

export type AnalysisJobKind = 'topologyBuild' | 'diagnosticsAnalyzeBatch';

/** Serializable topology opts (Set → string[]). */
export interface TopologyBuildJobRequest {
  kind: 'topologyBuild';
  sequence: number;
  interfaces: ReticulumTopologyInterfaceInput[];
  peers: ReticulumTopologyNodeInput[];
  opts: Omit<BuildReticulumMeshTopologyGraphOptions, 'serverPeerHashes'> & {
    serverPeerHashes?: string[];
  };
}

export interface TopologyBuildJobResult {
  kind: 'topologyBuild';
  sequence: number;
  graph: ReticulumTopologyGraph;
}

export interface DiagnosticsAnalyzeNodeInput {
  nodeId: number;
  node: MeshNode;
  stats?: { total: number; duplicates: number };
  hopHistory: HopHistoryPoint[];
  ignoreMqtt: boolean;
  noiseStats?: NoiseStats | null;
  tracePathSnrs?: number[];
  pathUpdatedTimestamps?: number[];
}

export interface DiagnosticsAnalyzeBatchRequest {
  kind: 'diagnosticsAnalyzeBatch';
  sequence: number;
  homeNode: MeshNode | null;
  distanceMultiplier: number;
  distanceOffsetKm: number;
  hopsThreshold: number;
  /** Narrow capabilities fields used by analyzeNode (avoid non-cloneable provider fields). */
  capabilities?: Pick<
    ProtocolCapabilities,
    'hasHopCount' | 'hasDistanceBasedHopAnomalies' | 'hasPerHopSnr' | 'protocol'
  >;
  nodes: DiagnosticsAnalyzeNodeInput[];
}

export interface DiagnosticsAnalyzeBatchResult {
  kind: 'diagnosticsAnalyzeBatch';
  sequence: number;
  /** nodeId → anomaly JSON (null entries omitted). */
  anomalies: { nodeId: number; anomaly: NodeAnomaly }[];
  clearedNodeIds: number[];
}

export type AnalysisJobRequest = TopologyBuildJobRequest | DiagnosticsAnalyzeBatchRequest;
export type AnalysisJobResult = TopologyBuildJobResult | DiagnosticsAnalyzeBatchResult;

export interface AnalysisJobError {
  kind: 'error';
  sequence: number;
  requestKind: AnalysisJobKind;
  error: string;
}

export type AnalysisWorkerInbound = AnalysisJobRequest;
export type AnalysisWorkerOutbound = AnalysisJobResult | AnalysisJobError;
