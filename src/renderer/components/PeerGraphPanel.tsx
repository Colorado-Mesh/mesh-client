import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FORCE_GRAPH_DEFAULTS,
  type ForceEdge,
  type SimNodeState,
  startForceSimulationLoop,
} from '../lib/forceDirectedGraphLayout';
import { nodeHealthScore, nodeHealthTier } from '../lib/nodeHealthScore';
import type { MeshNode } from '../lib/types';

interface PeerGraphPanelProps {
  nodes: Map<number, MeshNode>;
  myNodeId: number;
  onNodeClick?: (nodeId: number) => void;
}

type HealthTier = ReturnType<typeof nodeHealthTier>;

interface GraphNode {
  id: number;
  label: string;
  tier: HealthTier;
}

interface GraphEdge {
  source: number;
  target: number;
  hops: number;
}

interface RenderSnapshot {
  nodes: (GraphNode & { x: number; y: number })[];
  edges: GraphEdge[];
}

const TIER_FILL: Record<HealthTier, string> = {
  good: '#22c55e',
  warn: '#eab308',
  poor: '#ef4444',
};

const NODE_RADIUS = FORCE_GRAPH_DEFAULTS.nodePadding;

function buildEdges(myNodeId: number, nodes: Map<number, MeshNode>): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const node of nodes.values()) {
    if (node.node_id === myNodeId) continue;
    const h = node.hops_away ?? null;
    if (h === 0 || h === 1) {
      edges.push({ source: myNodeId, target: node.node_id, hops: h });
    }
  }
  return edges;
}

function toForceEdges(edges: GraphEdge[]): ForceEdge[] {
  return edges.map((e) => ({
    source: String(e.source),
    target: String(e.target),
    kind: e.hops === 0 ? 'direct' : 'relay',
  }));
}

export default function PeerGraphPanel({ nodes, myNodeId, onNodeClick }: PeerGraphPanelProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<SimNodeState[]>([]);
  const metaRef = useRef<Map<string, GraphNode>>(new Map());
  const edgesRef = useRef<GraphEdge[]>([]);
  const [snapshot, setSnapshot] = useState<RenderSnapshot>({ nodes: [], edges: [] });

  const rebuild = useCallback(() => {
    const width = svgRef.current?.clientWidth ?? 600;
    const height = svgRef.current?.clientHeight ?? 400;
    const cx = width / 2;
    const cy = height / 2;

    const connectedEdges = buildEdges(myNodeId, nodes);
    const connectedIds = new Set<number>([myNodeId]);
    for (const e of connectedEdges) {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }
    const ids = [...connectedIds].filter((id) => nodes.has(id));

    const existingById = new Map(simRef.current.map((n) => [n.id, n]));
    const meta = new Map<string, GraphNode>();
    simRef.current = ids.map((id, i) => {
      const node = nodes.get(id)!;
      const angle = (2 * Math.PI * i) / Math.max(1, ids.length);
      const r = Math.min(cx, cy) * 0.55;
      const existing = existingById.get(String(id));
      const graphNode: GraphNode = {
        id,
        label: node.short_name || `!${id.toString(16).slice(-4)}`,
        tier: nodeHealthTier(nodeHealthScore(node).total),
      };
      meta.set(String(id), graphNode);
      return {
        id: String(id),
        x: existing?.x ?? cx + r * Math.cos(angle),
        y: existing?.y ?? cy + r * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });
    metaRef.current = meta;
    edgesRef.current = connectedEdges;
  }, [nodes, myNodeId]);

  useEffect(() => {
    rebuild();
  }, [rebuild]);

  useEffect(() => {
    return startForceSimulationLoop({
      getSimNodes: () => simRef.current,
      getEdges: () => toForceEdges(edgesRef.current),
      getDimensions: () => ({
        width: svgRef.current?.clientWidth ?? 600,
        height: svgRef.current?.clientHeight ?? 400,
      }),
      onFrame: (simNodes) => {
        const renderNodes = simNodes
          .map((sn) => {
            const meta = metaRef.current.get(sn.id);
            if (!meta) return null;
            return { ...meta, x: sn.x, y: sn.y };
          })
          .filter((n): n is GraphNode & { x: number; y: number } => n != null);
        setSnapshot({ nodes: renderNodes, edges: [...edgesRef.current] });
      },
      nodePadding: NODE_RADIUS,
    });
  }, []);

  const totalNodes = nodes.size;

  if (totalNodes === 0) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        {t('peerGraph.noNodes')}
      </div>
    );
  }

  const { nodes: renderNodes, edges: renderEdges } = snapshot;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 px-4 py-2 text-xs text-slate-400">
        <span className="font-medium text-slate-300">{t('peerGraph.title')}</span>
        <span className="ml-auto flex items-center gap-2">
          {renderNodes.length < totalNodes && (
            <span className="text-slate-500">
              {t('peerGraph.hiddenCount', { shown: renderNodes.length, total: totalNodes })}
            </span>
          )}
          {t('peerGraph.nodeCount', { count: renderNodes.length })}
          {' · '}
          {t('peerGraph.edgeCount', { count: renderEdges.length })}
        </span>
      </div>
      <svg ref={svgRef} className="min-h-0 flex-1" aria-label={t('peerGraph.ariaLabel')} role="img">
        <defs>
          <pattern id="graph-bg" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="0.5" fill="#334155" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#graph-bg)" />

        {renderEdges.map((edge, i) => {
          const src = renderNodes.find((n) => n.id === edge.source);
          const tgt = renderNodes.find((n) => n.id === edge.target);
          if (!src || !tgt) return null;
          return (
            <line
              key={i}
              x1={src.x}
              y1={src.y}
              x2={tgt.x}
              y2={tgt.y}
              stroke={edge.hops === 0 ? '#64748b' : '#334155'}
              strokeWidth={edge.hops === 0 ? 2 : 1}
              strokeDasharray={edge.hops === 0 ? undefined : '4 4'}
              strokeOpacity={edge.hops === 0 ? 0.8 : 0.5}
            />
          );
        })}

        {renderNodes.map((node) => {
          const isSelf = node.id === myNodeId;
          const fill = isSelf ? '#8b5cf6' : TIER_FILL[node.tier];
          const r = isSelf ? NODE_RADIUS + 4 : NODE_RADIUS;
          return (
            <g
              key={node.id}
              transform={`translate(${node.x},${node.y})`}
              onClick={() => onNodeClick?.(node.id)}
              style={{ cursor: onNodeClick ? 'pointer' : undefined }}
              role={onNodeClick ? 'button' : undefined}
              aria-label={node.label}
            >
              {isSelf && (
                <circle
                  r={r + 6}
                  fill="none"
                  stroke="#c4b5fd"
                  strokeWidth={1}
                  strokeOpacity={0.4}
                />
              )}
              <circle
                r={r}
                fill={fill}
                fillOpacity={0.85}
                stroke={isSelf ? '#c4b5fd' : '#0f172a'}
                strokeWidth={1.5}
              />
              <text
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#f8fafc"
                fontSize={isSelf ? 10 : 9}
                fontWeight={isSelf ? 'bold' : 'normal'}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-4 px-4 py-2 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
          {t('peerGraph.me')}
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
          <svg width="24" height="8">
            <line x1="0" y1="4" x2="24" y2="4" stroke="#64748b" strokeWidth="2" />
          </svg>
          {t('peerGraph.directLink')}
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
          {t('peerGraph.relayLink')}
        </span>
      </div>
    </div>
  );
}
