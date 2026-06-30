/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  buildReticulumStarFallbackEdges,
  buildReticulumTopologyLayout,
} from '@/renderer/lib/reticulum/buildReticulumTopologyLayout';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { ReticulumTopologyEdge } from '@/shared/reticulum-types';

interface TopologyNode {
  destination_hash: string;
  display_name?: string | null;
  hops?: number | null;
}

interface RenderNode {
  id: string;
  label: string;
  x: number;
  y: number;
  depth: number;
  hops?: number | null;
  isRelay: boolean;
}

const NODE_R = 16;
const CENTER_R = 20;
const RELAY_R = 18;

export default function ReticulumTopologyPanel() {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<RenderNode[]>([]);
  const [edges, setEdges] = useState<ReticulumTopologyEdge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const refresh = useCallback(async () => {
    setError(null);
    if (!(await isReticulumSidecarRunning())) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/topology')) as {
        nodes?: TopologyNode[];
        edges?: ReticulumTopologyEdge[];
      };
      const peerNodes = body.nodes ?? [];
      const seenHashes = new Set<string>();
      const uniquePeers = peerNodes.filter((peer) => {
        if (!peer.destination_hash || seenHashes.has(peer.destination_hash)) return false;
        seenHashes.add(peer.destination_hash);
        return true;
      });
      const edgeList: ReticulumTopologyEdge[] =
        body.edges && body.edges.length > 0
          ? body.edges
          : buildReticulumStarFallbackEdges(uniquePeers);
      const rendered = buildReticulumTopologyLayout(uniquePeers, edgeList, {
        selfLabel: t('reticulumTopology.self'),
      });
      setNodes(rendered);
      setEdges(edgeList);
    } catch (e) {
      console.debug('[ReticulumTopologyPanel] refresh ' + errLikeToLogString(e));
      setError(errLikeToLogString(e));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    const unsub = window.electronAPI.reticulum.onEvent((evt) => {
      if (evt.type === 'peers_updated' || evt.type === 'stats_update') {
        void refresh();
      }
    });
    return unsub;
  }, [refresh]);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-200">{t('reticulumTopology.title')}</h3>
        <button
          type="button"
          className="text-xs text-amber-400 hover:underline"
          onClick={() => {
            void refresh();
          }}
        >
          {t('common.refresh')}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      <svg
        ref={svgRef}
        viewBox="0 0 400 320"
        className="mt-2 h-64 w-full rounded border border-gray-800 bg-slate-950"
        role="img"
        aria-label={t('reticulumTopology.title')}
      >
        {edges.map((edge, i) => {
          const a = nodeById.get(edge.source);
          const b = nodeById.get(edge.target);
          if (!a || !b) return null;
          return (
            <line
              key={`${edge.source}-${edge.target}-${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#4b5563"
              strokeWidth={1}
            />
          );
        })}
        {nodes.map((node) => {
          const isSelf = node.id === 'self';
          const r = isSelf ? CENTER_R : node.isRelay ? RELAY_R : NODE_R;
          const fill = isSelf ? '#16a34a' : node.isRelay ? '#b45309' : '#334155';
          return (
            <g key={node.id}>
              <circle cx={node.x} cy={node.y} r={r} fill={fill} stroke="#6b7280" strokeWidth={1} />
              <text x={node.x} y={node.y + r + 12} textAnchor="middle" fill="#d1d5db" fontSize={10}>
                {node.label}
              </text>
              {!isSelf && node.hops != null && node.hops > 1 ? (
                <text x={node.x} y={node.y + 4} textAnchor="middle" fill="#fbbf24" fontSize={9}>
                  {t('reticulumTopology.hopBadge', { count: node.hops })}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
