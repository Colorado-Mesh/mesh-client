import type {
  BuildReticulumMeshTopologyGraphOptions,
  ReticulumTopologyGraph,
  ReticulumTopologyInterfaceInput,
  ReticulumTopologyNodeInput,
} from '../reticulum/buildReticulumTopologyLayout';
import {
  nextAnalysisSequence,
  runAnalysisRequest,
  runAnalysisRequestInline,
} from './analysisWorkerPool';

export interface TopologyBuildArgs {
  interfaces: readonly ReticulumTopologyInterfaceInput[];
  peers: readonly ReticulumTopologyNodeInput[];
  opts: BuildReticulumMeshTopologyGraphOptions;
}

function toRequest(args: TopologyBuildArgs, sequence: number) {
  const { serverPeerHashes, ...rest } = args.opts;
  return {
    kind: 'topologyBuild' as const,
    sequence,
    interfaces: [...args.interfaces],
    peers: [...args.peers],
    opts: {
      ...rest,
      serverPeerHashes: serverPeerHashes ? [...serverPeerHashes] : undefined,
    },
  };
}

export async function runTopologyBuild(args: TopologyBuildArgs): Promise<ReticulumTopologyGraph> {
  const result = await runAnalysisRequest(toRequest(args, nextAnalysisSequence()));
  if (result.kind !== 'topologyBuild') {
    throw new Error(`unexpected analysis result ${result.kind}`);
  }
  return result.graph;
}

/** Sync equality path for tests and force-file inline callers. */
export function runTopologyBuildInline(args: TopologyBuildArgs): ReticulumTopologyGraph {
  const result = runAnalysisRequestInline(toRequest(args, nextAnalysisSequence()));
  if (result.kind !== 'topologyBuild') {
    throw new Error(`unexpected analysis result ${result.kind}`);
  }
  return result.graph;
}
