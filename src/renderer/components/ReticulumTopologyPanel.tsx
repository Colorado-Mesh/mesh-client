/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';

interface TopologyNode {
  destination_hash: string;
  display_name?: string | null;
  hops?: number | null;
}

interface TopologyEdge {
  source: string;
  target: string;
}

interface RenderNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

const NODE_R = 16;
const CENTER_R = 20;

export default function ReticulumTopologyPanel() {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<RenderNode[]>([]);
  const [edges, setEdges] = useState<TopologyEdge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const refresh = useCallback(async () => {
    setError(null);
    if (!(await isReticulumSidecarRunning())) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/topology')) as {
        nodes?: TopologyNode[];
        edges?: TopologyEdge[];
      };
      const peerNodes = body.nodes ?? [];
      const seenHashes = new Set<string>();
      const uniquePeers = peerNodes.filter((peer) => {
        if (!peer.destination_hash || seenHashes.has(peer.destination_hash)) return false;
        seenHashes.add(peer.destination_hash);
        return true;
      });
      const cx = 200;
      const cy = 160;
      const radius = Math.max(80, Math.min(140, 40 + uniquePeers.length * 8));
      const rendered: RenderNode[] = [
        { id: 'self', label: t('reticulumTopology.self'), x: cx, y: cy },
      ];
      uniquePeers.forEach((peer, i) => {
        const angle = (2 * Math.PI * i) / Math.max(uniquePeers.length, 1);
        rendered.push({
          id: peer.destination_hash,
          label: peer.display_name ?? peer.destination_hash.slice(0, 8),
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
        });
      });
      const edgeList: TopologyEdge[] =
        body.edges && body.edges.length > 0
          ? body.edges
          : uniquePeers.map((peer) => ({ source: 'self', target: peer.destination_hash }));
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
        {nodes.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={node.id === 'self' ? CENTER_R : NODE_R}
              fill={node.id === 'self' ? '#16a34a' : '#334155'}
              stroke="#6b7280"
              strokeWidth={1}
            />
            <text
              x={node.x}
              y={node.y + (node.id === 'self' ? CENTER_R : NODE_R) + 12}
              textAnchor="middle"
              fill="#d1d5db"
              fontSize={10}
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
