import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSvgPanZoom } from '@/renderer/lib/useSvgPanZoom';

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
  demotedDirectCount: number;
}

const TIER_FILL: Record<RenderNode['tier'], string> = {
  good: '#22c55e',
  warn: '#eab308',
  poor: '#ef4444',
};

const LABEL_ALWAYS_RELAY_MAX = 12;

function relaySpokeColor(online: boolean): string {
  return online ? '#22c55e' : '#ef4444';
}

function graphSizes(nodeCount: number): {
  centerR: number;
  relayR: number;
  peerR: number;
  nodePadding: number;
} {
  if (nodeCount > 36) {
    return { centerR: 18, relayR: 12, peerR: 7, nodePadding: 12 };
  }
  if (nodeCount > 20) {
    return { centerR: 20, relayR: 14, peerR: 9, nodePadding: 14 };
  }
  return { centerR: 22, relayR: 18, peerR: 12, nodePadding: FORCE_GRAPH_DEFAULTS.nodePadding };
}

function truncateLabel(label: string, maxLen: number): string {
  if (label.length <= maxLen) return label;
  return `${label.slice(0, maxLen - 1)}…`;
}

export default function PeerGraphPanel({ nodes, myNodeId, onNodeClick }: PeerGraphPanelProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<SimNodeState[]>([]);
  const metaRef = useRef<Map<string, MeshPeerTopologyGraphNode>>(new Map());
  const edgesRef = useRef<ForceEdge[]>([]);
  const statsRef = useRef({
    hiddenCount: 0,
    totalNodeCount: 0,
    relayCount: 0,
    demotedDirectCount: 0,
  });
  const [snapshot, setSnapshot] = useState<RenderSnapshot>({
    nodes: [],
    edges: [],
    hiddenCount: 0,
    totalNodeCount: 0,
    relayCount: 0,
    demotedDirectCount: 0,
  });
  const [includeDistantPeers, setIncludeDistantPeers] = useState(false);
  const [maxHops, setMaxHops] = useState<number | null>(2);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const { transform, resetView, bindSvgRef, onPointerDown, onPointerMove, onPointerUp } =
    useSvgPanZoom();

  const setSvgRef = useCallback(
    (el: SVGSVGElement | null) => {
      svgRef.current = el;
      bindSvgRef(el);
    },
    [bindSvgRef],
  );

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
      demotedDirectCount: statsRef.current.demotedDirectCount,
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
        demotedDirectCount: graph.demotedDirectCount,
      };
      publishSnapshotFromSim();
    },
    [publishSnapshotFromSim],
  );

  const rebuildGraph = useCallback(() => {
    const selfNode = nodes.get(myNodeId);
    const selfLabel =
      selfNode?.short_name?.trim() || selfNode?.long_name?.trim() || t('peerGraph.meShort');
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
    resetView();
  }, [includeDistantPeers, maxHops, resetView]);

  const sizes = useMemo(() => graphSizes(snapshot.nodes.length), [snapshot.nodes.length]);

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
      nodePadding: sizes.nodePadding,
    });
  }, [publishSnapshotFromSim, sizes.nodePadding]);

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
    demotedDirectCount,
  } = snapshot;
  const nodeById = new Map(renderNodes.map((n) => [n.id, n]));
  const hasGraph = renderNodes.length > 0;
  const activeNodeId = hoveredNodeId ?? focusedNodeId;
  const isDense = renderNodes.length > 20;
  const showAllLabels = !isDense;

  const shouldShowLabel = (node: RenderNode): boolean => {
    if (node.kind === 'self') return true;
    if (activeNodeId === node.id) return true;
    if (!showAllLabels) return false;
    if (node.kind === 'relay' && relayCount <= LABEL_ALWAYS_RELAY_MAX) return true;
    return node.kind === 'peer' && renderNodes.length <= 16;
  };

  const isEdgeHighlighted = (edge: ForceEdge): boolean => {
    if (!activeNodeId) return true;
    return edge.source === activeNodeId || edge.target === activeNodeId;
  };

  const tooltipNode = activeNodeId ? nodeById.get(activeNodeId) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-xs text-slate-400">
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
        <button
          type="button"
          className="text-slate-400 hover:text-slate-200"
          onClick={resetView}
          aria-label={t('peerGraph.resetView')}
        >
          {t('peerGraph.resetView')}
        </button>
        {hasGraph && relayCount > 0 ? (
          <span className="text-slate-500">{t('peerGraph.relayCount', { count: relayCount })}</span>
        ) : null}
        {hasGraph && demotedDirectCount > 0 ? (
          <span className="text-slate-500">
            {t('peerGraph.compactLeafCount', { count: demotedDirectCount })}
          </span>
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
      {isDense ? (
        <p className="text-muted px-4 pb-1 text-[11px]">{t('peerGraph.hoverHint')}</p>
      ) : null}
      {!hasGraph ? (
        <div className="text-muted flex flex-1 items-center justify-center text-xs">
          {t('peerGraph.noConnectedNodes')}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {tooltipNode ? (
            <div
              className="pointer-events-none absolute top-3 left-1/2 z-10 max-w-[min(90%,28rem)] -translate-x-1/2 rounded-md border border-slate-600 bg-slate-900/95 px-3 py-1.5 text-center text-xs text-slate-100 shadow-lg"
              role="status"
            >
              <span className="font-medium">{tooltipNode.label}</span>
              {tooltipNode.hops != null ? (
                <span className="text-slate-400">
                  {' · '}
                  {t('peerGraph.hopBadge', { count: tooltipNode.hops })}
                </span>
              ) : null}
            </div>
          ) : null}
          <svg
            ref={setSvgRef}
            className="h-full w-full cursor-grab active:cursor-grabbing"
            aria-label={t('peerGraph.ariaLabel')}
            role="img"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            style={{ touchAction: 'none' }}
          >
            <defs>
              <pattern id="peer-graph-bg" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="0.5" fill="#334155" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#peer-graph-bg)" />

            <g transform={transform}>
              {renderEdges.map((edge, i) => {
                const a = nodeById.get(edge.source);
                const b = nodeById.get(edge.target);
                if (!a || !b) return null;
                const isDirectSpoke = a.kind === 'self' && b.kind === 'relay';
                const highlighted = isEdgeHighlighted(edge);
                const stroke = isDirectSpoke ? relaySpokeColor(b.online) : '#64748b';
                const strokeWidth = isDirectSpoke ? 2.5 : 1;
                return (
                  <line
                    key={`${edge.source}-${edge.target}-${i}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    strokeDasharray={!isDirectSpoke ? '3 4' : undefined}
                    strokeOpacity={highlighted ? (isDirectSpoke ? 0.85 : 0.45) : 0.12}
                  />
                );
              })}

              {renderNodes.map((node) => {
                const showLabel = shouldShowLabel(node);
                const isActive = activeNodeId === node.id;
                const dimmed = activeNodeId != null && !isActive;

                if (node.kind === 'self') {
                  const fill = TIER_FILL[node.tier];
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x},${node.y})`}
                      opacity={dimmed ? 0.45 : 1}
                      onMouseEnter={() => {
                        setHoveredNodeId(node.id);
                      }}
                      onMouseLeave={() => {
                        setHoveredNodeId(null);
                      }}
                      onFocus={() => {
                        setFocusedNodeId(node.id);
                      }}
                      onBlur={() => {
                        setFocusedNodeId(null);
                      }}
                      onClick={() => onNodeClick?.(node.nodeId)}
                      style={{ cursor: onNodeClick ? 'pointer' : undefined }}
                      role={onNodeClick ? 'button' : undefined}
                      tabIndex={onNodeClick ? 0 : undefined}
                      aria-label={node.label}
                    >
                      <circle
                        r={sizes.centerR + 5}
                        fill="none"
                        stroke="#c4b5fd"
                        strokeWidth={1}
                        strokeOpacity={0.4}
                      />
                      <circle
                        r={sizes.centerR}
                        fill={fill}
                        fillOpacity={0.9}
                        stroke="#c4b5fd"
                        strokeWidth={2}
                      />
                      {showLabel ? (
                        <text
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#f8fafc"
                          fontSize={10}
                          fontWeight="bold"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {truncateLabel(node.label, 14)}
                        </text>
                      ) : null}
                    </g>
                  );
                }

                if (node.kind === 'relay') {
                  const r = sizes.relayR;
                  const fill = TIER_FILL[node.tier];
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x},${node.y})`}
                      opacity={dimmed ? 0.35 : 1}
                      onMouseEnter={() => {
                        setHoveredNodeId(node.id);
                      }}
                      onMouseLeave={() => {
                        setHoveredNodeId(null);
                      }}
                      onFocus={() => {
                        setFocusedNodeId(node.id);
                      }}
                      onBlur={() => {
                        setFocusedNodeId(null);
                      }}
                      onClick={() => onNodeClick?.(node.nodeId)}
                      style={{ cursor: onNodeClick ? 'pointer' : undefined }}
                      role={onNodeClick ? 'button' : undefined}
                      tabIndex={0}
                      aria-label={node.label}
                    >
                      <rect
                        x={-r}
                        y={-r}
                        width={r * 2}
                        height={r * 2}
                        rx={3}
                        fill={fill}
                        fillOpacity={node.online ? 0.85 : 0.55}
                        stroke={relaySpokeColor(node.online)}
                        strokeWidth={isActive ? 2 : 1.5}
                      />
                      {node.hubOutDegree > 0 ? (
                        <text
                          y={1}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#0f172a"
                          fontSize={8}
                          fontWeight={600}
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {node.hubOutDegree}
                        </text>
                      ) : null}
                      {showLabel ? (
                        <text
                          y={r + 11}
                          textAnchor="middle"
                          fill="#d1d5db"
                          fontSize={9}
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {truncateLabel(node.label, 16)}
                        </text>
                      ) : null}
                    </g>
                  );
                }

                const r = sizes.peerR;
                const fill = node.online ? TIER_FILL[node.tier] : '#475569';
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x},${node.y})`}
                    opacity={dimmed ? 0.3 : 0.92}
                    onMouseEnter={() => {
                      setHoveredNodeId(node.id);
                    }}
                    onMouseLeave={() => {
                      setHoveredNodeId(null);
                    }}
                    onFocus={() => {
                      setFocusedNodeId(node.id);
                    }}
                    onBlur={() => {
                      setFocusedNodeId(null);
                    }}
                    onClick={() => onNodeClick?.(node.nodeId)}
                    style={{ cursor: onNodeClick ? 'pointer' : undefined }}
                    role={onNodeClick ? 'button' : undefined}
                    tabIndex={0}
                    aria-label={node.label}
                  >
                    <circle
                      r={r + (isActive ? 2 : 1)}
                      fill="none"
                      stroke={relaySpokeColor(node.online)}
                      strokeWidth={isActive ? 2 : 1}
                      strokeOpacity={node.online ? 0.9 : 0.5}
                    />
                    <circle r={r} fill={fill} fillOpacity={0.92} stroke="#1e293b" strokeWidth={1} />
                    {showLabel ? (
                      <text
                        y={r + 10}
                        textAnchor="middle"
                        fill="#d1d5db"
                        fontSize={8}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        {truncateLabel(node.label, 12)}
                      </text>
                    ) : null}
                    {isActive && node.hops != null && node.hops > 1 ? (
                      <text
                        y={1}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#fef3c7"
                        fontSize={7}
                        fontWeight={600}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        {t('peerGraph.hopBadge', { count: node.hops })}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-slate-500">
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
            <line x1="0" y1="4" x2="24" y2="4" stroke="#22c55e" strokeWidth="2.5" />
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
              stroke="#64748b"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
          </svg>
          {t('peerGraph.relayLink')}
        </span>
      </div>
    </div>
  );
}
