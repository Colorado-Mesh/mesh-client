import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildMeshPeerTopologyGraph,
  type MeshPeerTopologyGraph,
  type MeshPeerTopologyGraphNode,
} from '@/renderer/lib/buildMeshPeerTopologyGraph';
import {
  FORCE_GRAPH_DEFAULTS,
  type ForceEdge,
  type SimNodeState,
  startForceSimulationLoop,
} from '@/renderer/lib/forceDirectedGraphLayout';
import type { MeshNode } from '@/renderer/lib/types';

interface PeerGraphPanelProps {
  nodes: Map<number, MeshNode>;
  myNodeId: number;
  onNodeClick?: (nodeId: number) => void;
}

interface RenderNode extends MeshPeerTopologyGraphNode {
  x: number;
  y: number;
}

interface RenderSnapshot {
  nodes: RenderNode[];
  edges: ForceEdge[];
  hiddenCount: number;
  totalNodeCount: number;
  relayCount: number;
}

const TIER_FILL: Record<RenderNode['tier'], string> = {
  good: '#22c55e',
  warn: '#eab308',
  poor: '#ef4444',
};

const CENTER_R = 22;
const RELAY_R = 18;
const PEER_R = 14;
const NODE_RADIUS = FORCE_GRAPH_DEFAULTS.nodePadding;

function relaySpokeColor(online: boolean): string {
  return online ? '#22c55e' : '#ef4444';
}

export default function PeerGraphPanel({ nodes, myNodeId, onNodeClick }: PeerGraphPanelProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<SimNodeState[]>([]);
  const metaRef = useRef<Map<string, MeshPeerTopologyGraphNode>>(new Map());
  const edgesRef = useRef<ForceEdge[]>([]);
  const statsRef = useRef({ hiddenCount: 0, totalNodeCount: 0, relayCount: 0 });
  const [snapshot, setSnapshot] = useState<RenderSnapshot>({
    nodes: [],
    edges: [],
    hiddenCount: 0,
    totalNodeCount: 0,
    relayCount: 0,
  });
  const [includeDistantPeers, setIncludeDistantPeers] = useState(true);
  const [maxHops, setMaxHops] = useState<number | null>(null);

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
      relayCount: statsRef.current.relayCount,
    });
  }, []);

  const applyGraph = useCallback(
    (graph: MeshPeerTopologyGraph) => {
      const width = svgRef.current?.clientWidth ?? 800;
      const height = svgRef.current?.clientHeight ?? 600;
      const cx = width / 2;
      const cy = height / 2;

      const existingById = new Map(simRef.current.map((n) => [n.id, n]));
      const meta = new Map<string, MeshPeerTopologyGraphNode>();

      simRef.current = graph.nodes.map((node) => {
        meta.set(node.id, node);
        const existing = existingById.get(node.id);
        const seedX = node.kind === 'self' ? cx : node.seedX * (width / 800);
        const seedY = node.kind === 'self' ? cy : node.seedY * (height / 600);
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
        relayCount: graph.relayCount,
      };
      publishSnapshotFromSim();
    },
    [publishSnapshotFromSim],
  );

  const rebuildGraph = useCallback(() => {
    const selfNode = nodes.get(myNodeId);
    const selfLabel =
      selfNode?.short_name?.trim() ||
      selfNode?.long_name?.trim() ||
      t('peerGraph.meShort', { defaultValue: 'You' });
    const width = svgRef.current?.clientWidth ?? 800;
    const height = svgRef.current?.clientHeight ?? 600;
    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId,
      selfLabel,
      cx: width / 2,
      cy: height / 2,
      filter: { includeDistantPeers, maxHops },
    });
    applyGraph(graph);
  }, [applyGraph, includeDistantPeers, maxHops, myNodeId, nodes, t]);

  useEffect(() => {
    rebuildGraph();
  }, [rebuildGraph]);

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
      nodePadding: NODE_RADIUS,
    });
  }, [publishSnapshotFromSim]);

  const totalNodes = nodes.size;

  if (totalNodes === 0) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        {t('peerGraph.noNodes')}
      </div>
    );
  }

  const {
    nodes: renderNodes,
    edges: renderEdges,
    hiddenCount,
    totalNodeCount,
    relayCount,
  } = snapshot;
  const nodeById = new Map(renderNodes.map((n) => [n.id, n]));
  const hasGraph = renderNodes.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 text-xs text-slate-400">
        <span className="font-medium text-slate-300">{t('peerGraph.title')}</span>
        <label className="flex items-center gap-1.5 text-slate-400">
          <input
            type="checkbox"
            checked={includeDistantPeers}
            onChange={(e) => {
              setIncludeDistantPeers(e.target.checked);
            }}
            aria-label={t('peerGraph.showDistantPeers')}
            className="accent-brand-green h-3.5 w-3.5 rounded"
          />
          {t('peerGraph.showDistantPeers')}
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          <span>{t('peerGraph.maxHopsFilter')}</span>
          <select
            value={maxHops ?? 'all'}
            onChange={(e) => {
              const value = e.target.value;
              setMaxHops(value === 'all' ? null : Number.parseInt(value, 10));
            }}
            aria-label={t('peerGraph.maxHopsFilter')}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
          >
            <option value="all">{t('peerGraph.maxHopsAll')}</option>
            {[1, 2, 3, 5, 8].map((hops) => (
              <option key={hops} value={hops}>
                {t('peerGraph.maxHopsOption', { count: hops })}
              </option>
            ))}
          </select>
        </label>
        {hasGraph && relayCount > 0 ? (
          <span className="text-slate-500">{t('peerGraph.relayCount', { count: relayCount })}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {hiddenCount > 0 && (
            <span className="text-slate-500">
              {t('peerGraph.hiddenCount', {
                shown: renderNodes.length,
                total: totalNodeCount,
              })}
            </span>
          )}
          {hasGraph && (
            <>
              {t('peerGraph.nodeCount', { count: renderNodes.length })}
              {' · '}
              {t('peerGraph.edgeCount', { count: renderEdges.length })}
            </>
          )}
        </span>
      </div>
      {!hasGraph ? (
        <div className="text-muted flex flex-1 items-center justify-center text-xs">
          {t('peerGraph.noConnectedNodes')}
        </div>
      ) : (
        <svg
          ref={svgRef}
          className="min-h-0 flex-1"
          aria-label={t('peerGraph.ariaLabel')}
          role="img"
        >
          <defs>
            <pattern id="peer-graph-bg" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="0.5" fill="#334155" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#peer-graph-bg)" />

          {renderEdges.map((edge, i) => {
            const a = nodeById.get(edge.source);
            const b = nodeById.get(edge.target);
            if (!a || !b) return null;
            const isDirectSpoke = a.kind === 'self' && b.kind === 'relay';
            const stroke = isDirectSpoke ? relaySpokeColor(b.online) : '#94a3b8';
            const strokeWidth = isDirectSpoke ? 3 : 1;
            return (
              <line
                key={`${edge.source}-${edge.target}-${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeDasharray={edge.kind === 'relay' && !isDirectSpoke ? '4 4' : undefined}
                strokeOpacity={isDirectSpoke ? 0.9 : 0.55}
              />
            );
          })}

          {renderNodes.map((node) => {
            if (node.kind === 'self') {
              const fill = TIER_FILL[node.tier];
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x},${node.y})`}
                  onClick={() => onNodeClick?.(node.nodeId)}
                  style={{ cursor: onNodeClick ? 'pointer' : undefined }}
                  role={onNodeClick ? 'button' : undefined}
                  aria-label={node.label}
                >
                  <circle
                    r={CENTER_R + 6}
                    fill="none"
                    stroke="#c4b5fd"
                    strokeWidth={1}
                    strokeOpacity={0.4}
                  />
                  <circle
                    r={CENTER_R}
                    fill={fill}
                    fillOpacity={0.9}
                    stroke="#c4b5fd"
                    strokeWidth={2}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#f8fafc"
                    fontSize={10}
                    fontWeight="bold"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {node.label}
                  </text>
                </g>
              );
            }

            if (node.kind === 'relay') {
              const r = RELAY_R;
              const fill = TIER_FILL[node.tier];
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x},${node.y})`}
                  onClick={() => onNodeClick?.(node.nodeId)}
                  style={{ cursor: onNodeClick ? 'pointer' : undefined }}
                  role={onNodeClick ? 'button' : undefined}
                  aria-label={node.label}
                >
                  <rect
                    x={-r}
                    y={-r}
                    width={r * 2}
                    height={r * 2}
                    rx={4}
                    fill={fill}
                    fillOpacity={node.online ? 0.85 : 0.55}
                    stroke={relaySpokeColor(node.online)}
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
                </g>
              );
            }

            const r = PEER_R;
            const fill = node.online ? TIER_FILL[node.tier] : '#475569';
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                onClick={() => onNodeClick?.(node.nodeId)}
                style={{ cursor: onNodeClick ? 'pointer' : undefined }}
                role={onNodeClick ? 'button' : undefined}
                aria-label={node.label}
              >
                <circle
                  r={r + 2}
                  fill="none"
                  stroke={relaySpokeColor(node.online)}
                  strokeWidth={1.5}
                  strokeOpacity={node.online ? 0.9 : 0.5}
                />
                <circle r={r} fill={fill} fillOpacity={0.92} stroke="#1e293b" strokeWidth={1} />
                <text
                  y={r + 12}
                  textAnchor="middle"
                  fill="#d1d5db"
                  fontSize={10}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {node.label}
                </text>
                {node.hops != null && node.hops > 1 ? (
                  <text
                    y={4}
                    textAnchor="middle"
                    fill="#fbbf24"
                    fontSize={8}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {t('peerGraph.hopBadge', { count: node.hops })}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
      <div className="flex flex-wrap gap-4 px-4 py-2 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
          {t('peerGraph.me')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-green-500" />
          {t('peerGraph.relayHub')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          {t('peerGraph.good')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
          {t('peerGraph.warn')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
          {t('peerGraph.poor')}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="24" height="8" aria-hidden>
            <line x1="0" y1="4" x2="24" y2="4" stroke="#22c55e" strokeWidth="3" />
          </svg>
          {t('peerGraph.directLink')}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="24" height="8" aria-hidden>
            <line
              x1="0"
              y1="4"
              x2="24"
              y2="4"
              stroke="#94a3b8"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          </svg>
          {t('peerGraph.relayLink')}
        </span>
      </div>
    </div>
  );
}
