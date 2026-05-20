import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  /** 0 = direct link, 1 = one-hop link */
  hops: number;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
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

/**
 * Build edges for both protocols using hops_away.
 * hops_away === 0 → direct link to my node (thick solid edge)
 * hops_away === 1 → one-hop link to my node (thin dashed edge)
 * Higher hops_away → no edge drawn (node still shown)
 */
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

const NODE_RADIUS = 18;
const REPULSION = 8000;
const SPRING_LEN_DIRECT = 140;
const SPRING_LEN_HOP = 220;
const SPRING_K = 0.06;
const DAMPING = 0.6;
const MAX_V = 8;
const RENDER_EVERY = 2;

export default function PeerGraphPanel({ nodes, myNodeId, onNodeClick }: PeerGraphPanelProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const frameRef = useRef(0);
  const animRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<RenderSnapshot>({ nodes: [], edges: [] });

  const rebuild = useCallback(() => {
    const width = svgRef.current?.clientWidth ?? 600;
    const height = svgRef.current?.clientHeight ?? 400;
    const cx = width / 2;
    const cy = height / 2;

    // Only include nodes with a known direct or relay connection, plus my own node.
    // Nodes with hops_away >= 2 or null have no edge data and would just add O(n²) cost.
    const connectedEdges = buildEdges(myNodeId, nodes);
    const connectedIds = new Set<number>([myNodeId]);
    for (const e of connectedEdges) {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }
    const ids = [...connectedIds].filter((id) => nodes.has(id));

    const existingById = new Map(simRef.current.map((n) => [n.id, n]));
    simRef.current = ids.map((id, i) => {
      const node = nodes.get(id)!;
      const angle = (2 * Math.PI * i) / Math.max(1, ids.length);
      const r = Math.min(cx, cy) * 0.55;
      const existing = existingById.get(id);
      return {
        id,
        label: node.short_name || `!${id.toString(16).slice(-4)}`,
        tier: nodeHealthTier(nodeHealthScore(node).total),
        x: existing?.x ?? cx + r * Math.cos(angle),
        y: existing?.y ?? cy + r * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });

    edgesRef.current = connectedEdges;
  }, [nodes, myNodeId]);

  useEffect(() => {
    rebuild();
  }, [rebuild]);

  useEffect(() => {
    let running = true;
    frameRef.current = 0;

    function step() {
      if (!running) return;
      const ns = simRef.current;
      const es = edgesRef.current;
      const width = svgRef.current?.clientWidth ?? 600;
      const height = svgRef.current?.clientHeight ?? 400;

      if (ns.length === 0) {
        animRef.current = requestAnimationFrame(step);
        return;
      }

      const fx = new Float64Array(ns.length);
      const fy = new Float64Array(ns.length);

      // Repulsion between all node pairs
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const dx = ns[j].x - ns[i].x || 0.01;
          const dy = ns[j].y - ns[i].y || 0.01;
          const distSq = Math.max(1, dx * dx + dy * dy);
          const dist = Math.sqrt(distSq);
          const force = REPULSION / distSq;
          fx[i] -= (force * dx) / dist;
          fy[i] -= (force * dy) / dist;
          fx[j] += (force * dx) / dist;
          fy[j] += (force * dy) / dist;
        }
      }

      // Spring attraction along edges
      for (const edge of es) {
        const si = ns.findIndex((n) => n.id === edge.source);
        const ti = ns.findIndex((n) => n.id === edge.target);
        if (si < 0 || ti < 0) continue;
        const dx = ns[ti].x - ns[si].x;
        const dy = ns[ti].y - ns[si].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetLen = edge.hops === 0 ? SPRING_LEN_DIRECT : SPRING_LEN_HOP;
        const force = SPRING_K * (dist - targetLen);
        fx[si] += (force * dx) / dist;
        fy[si] += (force * dy) / dist;
        fx[ti] -= (force * dx) / dist;
        fy[ti] -= (force * dy) / dist;
      }

      // Gentle centering pull
      const cx = width / 2;
      const cy = height / 2;
      for (let i = 0; i < ns.length; i++) {
        fx[i] += (cx - ns[i].x) * 0.003;
        fy[i] += (cy - ns[i].y) * 0.003;
      }

      // Integrate
      for (let i = 0; i < ns.length; i++) {
        ns[i].vx = Math.max(-MAX_V, Math.min(MAX_V, (ns[i].vx + fx[i]) * DAMPING));
        ns[i].vy = Math.max(-MAX_V, Math.min(MAX_V, (ns[i].vy + fy[i]) * DAMPING));
        ns[i].x = Math.max(NODE_RADIUS, Math.min(width - NODE_RADIUS, ns[i].x + ns[i].vx));
        ns[i].y = Math.max(NODE_RADIUS, Math.min(height - NODE_RADIUS, ns[i].y + ns[i].vy));
      }

      frameRef.current++;
      if (frameRef.current % RENDER_EVERY === 0) {
        setSnapshot({
          nodes: ns.map(({ id, label, tier, x, y }) => ({ id, label, tier, x, y })),
          edges: [...es],
        });
      }
      animRef.current = requestAnimationFrame(step);
    }

    animRef.current = requestAnimationFrame(step);
    return () => {
      running = false;
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
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

        {/* Edges */}
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

        {/* Nodes */}
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
