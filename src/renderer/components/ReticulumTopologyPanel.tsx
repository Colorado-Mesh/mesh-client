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
  buildReticulumMeshTopologyGraph,
  type ReticulumTopologyGraph,
  type ReticulumTopologyGraphNode,
} from '@/renderer/lib/reticulum/buildReticulumTopologyLayout';
import {
  fetchReticulumInterfaces,
  isReticulumSidecarRunning,
  type ReticulumSidecarInterfaceRow,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  normalizeReticulumInterfaceGlyphType,
  type ReticulumTopologyInterfaceGlyph,
} from '@/renderer/lib/reticulum/reticulumTopologyInterfaceGlyph';
import type { ReticulumPeerWireRow } from '@/shared/reticulum-types';

import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import { reticulumPeerDisplayName, useReticulumPeerStore } from '../stores/reticulumPeerStore';

function enrichTopologyPeers(peers: ReticulumPeerWireRow[]): ReticulumPeerWireRow[] {
  const storePeers = useReticulumPeerStore.getState().peers;
  const contacts = useReticulumPeerStore.getState().contacts;
  const nomadNodes = useNomadNetworkStore.getState().nodes;

  return peers.map((peer) => {
    const hash = peer.destination_hash.toLowerCase();
    const fromStore = storePeers.get(hash) ?? contacts.get(hash);
    const fromNomad = nomadNodes.get(hash);
    const display_name =
      peer.display_name?.trim() ||
      (fromStore ? reticulumPeerDisplayName(fromStore) : null) ||
      fromNomad?.display_name?.trim() ||
      null;
    const interfaceName =
      peer.interface?.trim() || fromStore?.interface?.trim() || peer.interface || null;
    if (display_name && display_name !== hash.slice(0, 12) && interfaceName === peer.interface) {
      return { ...peer, display_name };
    }
    return {
      ...peer,
      display_name:
        display_name && display_name !== hash.slice(0, 12) ? display_name : peer.display_name,
      interface: interfaceName,
    };
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
  onlineInterfaceCount: number;
  offlineInterfaceCount: number;
}

const SELF_ID = 'self';
const CENTER_R = 22;
const INTERFACE_R = 18;
const PEER_R = 14;

function interfaceSpokeColor(online: boolean): string {
  return online ? '#22c55e' : '#ef4444';
}

function peerFill(node: RenderNode): string {
  if (!node.online) return '#475569';
  return node.peerKind === 'server' ? '#64748b' : '#2563eb';
}

function peerStroke(node: RenderNode): string {
  return node.online ? '#22c55e' : '#ef4444';
}

function interfaceGlyphAriaKey(glyph: ReticulumTopologyInterfaceGlyph): string {
  switch (glyph) {
    case 'wifi':
      return 'reticulumTopology.glyphWifi';
    case 'lora':
      return 'reticulumTopology.glyphLora';
    case 'serial':
      return 'reticulumTopology.glyphSerial';
    default:
      return 'reticulumTopology.glyphTcp';
  }
}

function InterfaceGlyph({
  glyph,
  ariaLabel,
}: {
  glyph: ReticulumTopologyInterfaceGlyph;
  ariaLabel: string;
}) {
  const stroke = '#f8fafc';
  const strokeWidth = 1.2;
  switch (glyph) {
    case 'wifi':
      return (
        <g aria-label={ariaLabel}>
          <path
            d="M0,-7 C-5,-2 -5,2 0,7 C5,2 5,-2 0,-7"
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          <path
            d="M-4,-3 C-2,-1 -2,1 -4,3"
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          <circle cy={4} r={1.2} fill={stroke} />
        </g>
      );
    case 'lora':
      return (
        <g aria-label={ariaLabel}>
          <path
            d="M-6,4 L-2,-4 L2,4"
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M-3,4 L0,-1 L3,4"
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cy={4} r={1.2} fill={stroke} />
        </g>
      );
    case 'serial':
      return (
        <g aria-label={ariaLabel}>
          <rect
            x={-5}
            y={-3}
            width={10}
            height={6}
            rx={1}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          <path
            d="M-7,0 L-5,0 M5,0 L7,0"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        </g>
      );
    default:
      return (
        <g aria-label={ariaLabel}>
          <circle r={5} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
          <path
            d="M-3,-1 L3,-1 M-3,1 L3,1 M-1,-3 L-1,3 M1,-3 L1,3"
            stroke={stroke}
            strokeWidth={1}
            strokeLinecap="round"
          />
        </g>
      );
  }
}

interface ReticulumTopologyPanelProps {
  onPeerClick?: (peerHash: string) => void;
}

export default function ReticulumTopologyPanel({ onPeerClick }: ReticulumTopologyPanelProps = {}) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<SimNodeState[]>([]);
  const metaRef = useRef<Map<string, ReticulumTopologyGraphNode>>(new Map());
  const edgesRef = useRef<ForceEdge[]>([]);
  const statsRef = useRef({
    hiddenCount: 0,
    totalNodeCount: 0,
    onlineInterfaceCount: 0,
    offlineInterfaceCount: 0,
  });
  const [snapshot, setSnapshot] = useState<RenderSnapshot>({
    nodes: [],
    edges: [],
    hiddenCount: 0,
    totalNodeCount: 0,
    onlineInterfaceCount: 0,
    offlineInterfaceCount: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
      onlineInterfaceCount: statsRef.current.onlineInterfaceCount,
      offlineInterfaceCount: statsRef.current.offlineInterfaceCount,
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
      const interfaceNodes = graph.nodes.filter((n) => n.kind === 'interface');
      statsRef.current = {
        hiddenCount: graph.hiddenCount,
        totalNodeCount: graph.totalNodeCount,
        onlineInterfaceCount: interfaceNodes.filter((n) => n.online).length,
        offlineInterfaceCount: interfaceNodes.filter((n) => !n.online).length,
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
      const [topologyBody, interfaces, identityBody] = await Promise.all([
        window.electronAPI.reticulum.proxyGet('/api/v1/topology') as Promise<{
          nodes?: ReticulumPeerWireRow[];
        }>,
        fetchReticulumInterfaces(),
        window.electronAPI.reticulum.proxyGet('/api/v1/identity/status') as Promise<{
          display_name?: string | null;
        }>,
      ]);

      const peerNodes = enrichTopologyPeers(topologyBody.nodes ?? []);
      const seenHashes = new Set<string>();
      const uniquePeers = peerNodes.filter((peer) => {
        if (!peer.destination_hash || seenHashes.has(peer.destination_hash)) return false;
        seenHashes.add(peer.destination_hash);
        return true;
      });

      const selfLabel = identityBody.display_name?.trim() || t('reticulumTopology.self');

      const serverPeerHashes = new Set(
        [...useNomadNetworkStore.getState().nodes.keys()].map((h) => h.toLowerCase()),
      );

      const width = svgRef.current?.clientWidth ?? 800;
      const height = svgRef.current?.clientHeight ?? 600;
      const graph = buildReticulumMeshTopologyGraph(
        interfaces.map((iface: ReticulumSidecarInterfaceRow) => ({
          id: iface.id,
          name: iface.name,
          type: iface.type,
          enabled: iface.enabled,
          status: iface.status,
        })),
        uniquePeers,
        {
          selfLabel,
          unassignedInterfaceLabel: t('reticulumTopology.unassignedInterface'),
          cx: width / 2,
          cy: height / 2,
          filter: { includeDistantPeers, maxHops },
          serverPeerHashes,
        },
      );
      applyGraph(graph);
      setLoading(false);
    } catch (e) {
      console.debug('[ReticulumTopologyPanel] refresh ' + errLikeToLogString(e));
      setError(errLikeToLogString(e));
      setLoading(false);
    }
  }, [applyGraph, includeDistantPeers, maxHops, t]);

  useEffect(() => {
    void refresh();
    const unsub = window.electronAPI.reticulum.onEvent((evt) => {
      if (
        evt.type === 'peers_updated' ||
        evt.type === 'stats_update' ||
        evt.type === 'interface.state'
      ) {
        void refresh();
      }
    });
    return unsub;
  }, [includeDistantPeers, maxHops, refresh]);

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

  const { nodes, edges, hiddenCount, totalNodeCount, onlineInterfaceCount, offlineInterfaceCount } =
    snapshot;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const hasGraph = nodes.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 text-xs text-slate-400">
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
        <label className="flex items-center gap-1.5 text-slate-400">
          <input
            type="checkbox"
            checked={includeDistantPeers}
            onChange={(e) => {
              setIncludeDistantPeers(e.target.checked);
            }}
            aria-label={t('reticulumTopology.showDistantPeers')}
            className="accent-brand-green h-3.5 w-3.5 rounded"
          />
          {t('reticulumTopology.showDistantPeers')}
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          <span>{t('reticulumTopology.maxHopsFilter')}</span>
          <select
            value={maxHops ?? 'all'}
            onChange={(e) => {
              const value = e.target.value;
              setMaxHops(value === 'all' ? null : Number.parseInt(value, 10));
            }}
            aria-label={t('reticulumTopology.maxHopsFilter')}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
          >
            <option value="all">{t('reticulumTopology.maxHopsAll')}</option>
            {[1, 2, 3, 5, 8].map((hops) => (
              <option key={hops} value={hops}>
                {t('reticulumTopology.maxHopsOption', { count: hops })}
              </option>
            ))}
          </select>
        </label>
        {hasGraph && (
          <span className="text-slate-500">
            {t('reticulumTopology.interfaceStatus', {
              online: onlineInterfaceCount,
              offline: offlineInterfaceCount,
            })}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {hiddenCount > 0 && (
            <span className="text-slate-500">
              {t('reticulumTopology.hiddenCount', {
                shown: nodes.length,
                total: totalNodeCount,
              })}
            </span>
          )}
          {hasGraph && (
            <>
              {t('reticulumTopology.nodeCount', { count: nodes.length })}
              {' · '}
              {t('reticulumTopology.edgeCount', { count: edges.length })}
            </>
          )}
        </span>
      </div>
      {error ? <p className="px-4 text-xs text-red-400">{error}</p> : null}
      {loading && !hasGraph && !error ? (
        <div className="text-muted flex flex-1 items-center justify-center text-xs">
          {t('common.loading')}
        </div>
      ) : !hasGraph && !error ? (
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
            const isInterfaceSpoke = a.kind === 'self' && b.kind === 'interface';
            const stroke = isInterfaceSpoke ? interfaceSpokeColor(b.online) : '#94a3b8';
            const strokeWidth = isInterfaceSpoke ? 3 : 1;
            return (
              <line
                key={`${edge.source}-${edge.target}-${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeOpacity={isInterfaceSpoke ? 0.9 : 0.55}
              />
            );
          })}

          {nodes.map((node) => {
            if (node.kind === 'self') {
              return (
                <g key={node.id} transform={`translate(${node.x},${node.y})`}>
                  <circle r={CENTER_R} fill="#f8fafc" stroke="#0f172a" strokeWidth={2} />
                  <text
                    y={4}
                    textAnchor="middle"
                    fill="#0f172a"
                    fontSize={11}
                    fontWeight={600}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {t('reticulumTopology.centerRns')}
                  </text>
                  <text
                    y={CENTER_R + 14}
                    textAnchor="middle"
                    fill="#e2e8f0"
                    fontSize={10}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {node.label}
                  </text>
                </g>
              );
            }

            if (node.kind === 'interface') {
              const r = INTERFACE_R;
              const fill = node.online ? '#16a34a' : '#dc2626';
              const glyph = normalizeReticulumInterfaceGlyphType(node.interfaceType);
              const statusLabel = node.online
                ? t('reticulumTopology.interfaceStatusOnline')
                : t('reticulumTopology.interfaceStatusOffline');
              const tooltip = t('reticulumTopology.interfaceTooltip', {
                name: node.label,
                status: statusLabel,
              });
              return (
                <g key={node.id} transform={`translate(${node.x},${node.y})`}>
                  <title>{tooltip}</title>
                  <rect
                    x={-r}
                    y={-r}
                    width={r * 2}
                    height={r * 2}
                    rx={4}
                    fill={fill}
                    fillOpacity={0.85}
                    stroke={node.online ? '#22c55e' : '#ef4444'}
                    strokeWidth={1.5}
                  />
                  <InterfaceGlyph glyph={glyph} ariaLabel={t(interfaceGlyphAriaKey(glyph))} />
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
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                onClick={() => onPeerClick?.(node.id)}
                style={{ cursor: onPeerClick ? 'pointer' : undefined }}
                role={onPeerClick ? 'button' : undefined}
                tabIndex={onPeerClick ? 0 : undefined}
                aria-label={node.label}
              >
                <circle
                  r={r + 2}
                  fill="none"
                  stroke={peerStroke(node)}
                  strokeWidth={1.5}
                  strokeOpacity={node.online ? 0.9 : 0.6}
                />
                <circle
                  r={r}
                  fill={peerFill(node)}
                  fillOpacity={0.92}
                  stroke="#1e293b"
                  strokeWidth={1}
                />
                {node.peerKind === 'server' ? (
                  <g aria-hidden>
                    <rect x={-4} y={-5} width={8} height={3} fill="#f8fafc" rx={0.5} />
                    <rect x={-4} y={-1} width={8} height={3} fill="#f8fafc" rx={0.5} />
                    <rect x={-4} y={3} width={8} height={3} fill="#f8fafc" rx={0.5} />
                  </g>
                ) : (
                  <circle cy={-2} r={3} fill="#f8fafc" aria-hidden />
                )}
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
          <span className="inline-block h-2 w-2 rounded-full bg-slate-100" />
          {t('reticulumTopology.legendSelf')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-green-600" />
          {t('reticulumTopology.legendInterfaceOnline')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-red-600" />
          {t('reticulumTopology.legendInterfaceOffline')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-600" />
          {t('reticulumTopology.legendPeerUser')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-500" />
          {t('reticulumTopology.legendPeerServer')}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="24" height="8" aria-hidden>
            <line x1="0" y1="4" x2="24" y2="4" stroke="#22c55e" strokeWidth="3" />
          </svg>
          {t('reticulumTopology.interfaceLink')}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="24" height="8" aria-hidden>
            <line x1="0" y1="4" x2="24" y2="4" stroke="#94a3b8" strokeWidth="1" />
          </svg>
          {t('reticulumTopology.peerLink')}
        </span>
      </div>
    </div>
  );
}
