/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  type ForceEdge,
  type SimNodeState,
  startForceSimulationLoop,
} from '@/renderer/lib/forceDirectedGraphLayout';
import {
  buildReticulumStarFallbackEdges,
  buildReticulumTopologyGraph,
  buildReticulumViaHashEdges,
  type ReticulumTopologyGraph,
  type ReticulumTopologyGraphNode,
  shouldUseReticulumStarFallbackEdges,
} from '@/renderer/lib/reticulum/buildReticulumTopologyLayout';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { ReticulumTopologyEdge } from '@/shared/reticulum-types';

import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import { reticulumPeerDisplayName, useReticulumPeerStore } from '../stores/reticulumPeerStore';

interface TopologyNode {
  destination_hash: string;
  display_name?: string | null;
  hops?: number | null;
  via_hash?: string | null;
}

function enrichTopologyPeerNames(nodes: TopologyNode[]): TopologyNode[] {
  const peers = useReticulumPeerStore.getState().peers;
  const contacts = useReticulumPeerStore.getState().contacts;
  const nomadNodes = useNomadNetworkStore.getState().nodes;

  return nodes.map((node) => {
    if (node.display_name?.trim()) return node;
    const hash = node.destination_hash.toLowerCase();
    const fromPeer = peers.get(hash) ?? contacts.get(hash);
    const fromNomad = nomadNodes.get(hash);
    const display_name =
      (fromPeer ? reticulumPeerDisplayName(fromPeer) : null) ||
      fromNomad?.display_name?.trim() ||
      null;
    if (!display_name || display_name === hash.slice(0, 12)) return node;
    return { ...node, display_name };
  });
}

interface RenderNode extends ReticulumTopologyGraphNode {
  x: number;
  y: number;
}

interface RenderSnapshot {
  nodes: RenderNode[];
  edges: ForceEdge[];
  hiddenCount: number;
  totalNodeCount: number;
}

const SELF_ID = 'self';
const BASE_NODE_R = 16;
const CENTER_R = 20;
const HUB_BASE_R = 18;

function hubRadius(outDegree: number): number {
  return Math.min(HUB_BASE_R + outDegree * 2, 28);
}

export default function ReticulumTopologyPanel() {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<SimNodeState[]>([]);
  const metaRef = useRef<Map<string, ReticulumTopologyGraphNode>>(new Map());
  const edgesRef = useRef<ForceEdge[]>([]);
  const statsRef = useRef({ hiddenCount: 0, totalNodeCount: 0 });
  const [snapshot, setSnapshot] = useState<RenderSnapshot>({
    nodes: [],
    edges: [],
    hiddenCount: 0,
    totalNodeCount: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const publishSnapshotFromSim = useCallback(() => {
    const renderNodes = simRef.current
      .map((sn) => {
        const meta = metaRef.current.get(sn.id);
        if (!meta) return null;
        return { ...meta, x: sn.x, y: sn.y };
      })
      .filter((n): n is RenderNode => n != null);
    setSnapshot({
      nodes: renderNodes,
      edges: [...edgesRef.current],
      hiddenCount: statsRef.current.hiddenCount,
      totalNodeCount: statsRef.current.totalNodeCount,
    });
  }, []);

  const applyGraph = useCallback(
    (graph: ReticulumTopologyGraph) => {
      const width = svgRef.current?.clientWidth ?? 800;
      const height = svgRef.current?.clientHeight ?? 600;
      const cx = width / 2;
      const cy = height / 2;

      const existingById = new Map(simRef.current.map((n) => [n.id, n]));
      const meta = new Map<string, ReticulumTopologyGraphNode>();

      simRef.current = graph.nodes.map((node) => {
        meta.set(node.id, node);
        const existing = existingById.get(node.id);
        const seedX = node.id === SELF_ID ? cx : node.seedX * (width / 800);
        const seedY = node.id === SELF_ID ? cy : node.seedY * (height / 600);
        return {
          id: node.id,
          x: existing?.x ?? seedX,
          y: existing?.y ?? seedY,
          vx: 0,
          vy: 0,
        };
      });

      metaRef.current = meta;
      edgesRef.current = graph.edges;
      statsRef.current = {
        hiddenCount: graph.hiddenCount,
        totalNodeCount: graph.totalNodeCount,
      };
      publishSnapshotFromSim();
    },
    [publishSnapshotFromSim],
  );

  const refresh = useCallback(async () => {
    setError(null);
    if (!(await isReticulumSidecarRunning())) {
      setLoading(false);
      return;
    }
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/topology')) as {
        nodes?: TopologyNode[];
        edges?: ReticulumTopologyEdge[];
      };
      const peerNodes = enrichTopologyPeerNames(body.nodes ?? []);
      const seenHashes = new Set<string>();
      const uniquePeers = peerNodes.filter((peer) => {
        if (!peer.destination_hash || seenHashes.has(peer.destination_hash)) return false;
        seenHashes.add(peer.destination_hash);
        return true;
      });
      const edgeList: ReticulumTopologyEdge[] =
        body.edges && body.edges.length > 0
          ? body.edges
          : shouldUseReticulumStarFallbackEdges(uniquePeers, body.edges ?? [])
            ? buildReticulumStarFallbackEdges(uniquePeers)
            : buildReticulumViaHashEdges(uniquePeers);

      const width = svgRef.current?.clientWidth ?? 800;
      const height = svgRef.current?.clientHeight ?? 600;
      const graph = buildReticulumTopologyGraph(uniquePeers, edgeList, {
        selfLabel: t('reticulumTopology.self'),
        cx: width / 2,
        cy: height / 2,
      });
      applyGraph(graph);
      setLoading(false);
    } catch (e) {
      console.debug('[ReticulumTopologyPanel] refresh ' + errLikeToLogString(e));
      setError(errLikeToLogString(e));
      setLoading(false);
    }
  }, [applyGraph, t]);

  useEffect(() => {
    void refresh();
    const unsub = window.electronAPI.reticulum.onEvent((evt) => {
      if (evt.type === 'peers_updated' || evt.type === 'stats_update') {
        void refresh();
      }
    });
    return unsub;
  }, [refresh]);

  useEffect(() => {
    return startForceSimulationLoop({
      getSimNodes: () => simRef.current,
      getEdges: () => edgesRef.current,
      getDimensions: () => ({
        width: svgRef.current?.clientWidth ?? 800,
        height: svgRef.current?.clientHeight ?? 600,
      }),
      onFrame: () => {
        publishSnapshotFromSim();
      },
      nodePadding: CENTER_R,
    });
  }, [publishSnapshotFromSim]);

  const { nodes, edges, hiddenCount, totalNodeCount } = snapshot;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 px-4 py-2 text-xs text-slate-400">
        <span className="font-medium text-slate-300">{t('reticulumTopology.title')}</span>
        <button
          type="button"
          className="text-amber-400 hover:underline"
          onClick={() => {
            void refresh();
          }}
        >
          {t('common.refresh')}
        </button>
        <span className="ml-auto flex items-center gap-2">
          {hiddenCount > 0 && (
            <span className="text-slate-500">
              {t('reticulumTopology.hiddenCount', {
                shown: nodes.length,
                total: totalNodeCount,
              })}
            </span>
          )}
          {nodes.length > 0 && (
            <>
              {t('reticulumTopology.nodeCount', { count: nodes.length })}
              {' · '}
              {t('reticulumTopology.edgeCount', { count: edges.length })}
            </>
          )}
        </span>
      </div>
      {error ? <p className="px-4 text-xs text-red-400">{error}</p> : null}
      {loading && nodes.length === 0 && !error ? (
        <div className="text-muted flex flex-1 items-center justify-center text-xs">
          {t('common.loading')}
        </div>
      ) : nodes.length === 0 && !error ? (
        <div className="text-muted flex flex-1 items-center justify-center text-xs">
          {t('reticulumTopology.noNodes')}
        </div>
      ) : (
        <svg
          ref={svgRef}
          className="min-h-0 flex-1"
          aria-label={t('reticulumTopology.ariaLabel')}
          role="img"
        >
          <defs>
            <pattern id="topology-bg" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="0.5" fill="#334155" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#topology-bg)" />

          {edges.map((edge, i) => {
            const a = nodeById.get(edge.source);
            const b = nodeById.get(edge.target);
            if (!a || !b) return null;
            const isDirect = edge.kind === 'direct';
            return (
              <line
                key={`${edge.source}-${edge.target}-${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={isDirect ? '#64748b' : '#334155'}
                strokeWidth={isDirect ? 2 : 1}
                strokeDasharray={isDirect ? undefined : '4 4'}
                strokeOpacity={isDirect ? 0.8 : 0.5}
              />
            );
          })}

          {nodes.map((node) => {
            const isSelf = node.id === SELF_ID;
            const r = isSelf ? CENTER_R : node.isHub ? hubRadius(node.hubOutDegree) : BASE_NODE_R;
            const fill = isSelf ? '#16a34a' : node.isHub ? '#b45309' : '#334155';
            return (
              <g key={node.id} transform={`translate(${node.x},${node.y})`}>
                {node.isHub && (
                  <circle
                    r={r + 4}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth={1}
                    strokeOpacity={0.35}
                  />
                )}
                <circle
                  r={r}
                  fill={fill}
                  fillOpacity={0.9}
                  stroke={isSelf ? '#22c55e' : node.isHub ? '#fbbf24' : '#6b7280'}
                  strokeWidth={1.5}
                />
                <text
                  y={r + 12}
                  textAnchor="middle"
                  fill="#d1d5db"
                  fontSize={10}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {node.label}
                </text>
                {!isSelf && node.hops != null && node.hops > 1 ? (
                  <text
                    y={4}
                    textAnchor="middle"
                    fill="#fbbf24"
                    fontSize={9}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {t('reticulumTopology.hopBadge', { count: node.hops })}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
      <div className="flex flex-wrap gap-4 px-4 py-2 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
          {t('reticulumTopology.legendSelf')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-600" />
          {t('reticulumTopology.legendHub')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-600" />
          {t('reticulumTopology.legendPeer')}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="24" height="8">
            <line x1="0" y1="4" x2="24" y2="4" stroke="#64748b" strokeWidth="2" />
          </svg>
          {t('reticulumTopology.directLink')}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="24" height="8">
            <line
              x1="0"
              y1="4"
              x2="24"
              y2="4"
              stroke="#475569"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          </svg>
          {t('reticulumTopology.relayLink')}
        </span>
      </div>
    </div>
  );
}
