import type { ForceEdge } from './forceDirectedGraphLayout';
import { nodeHealthScore, type NodeHealthTier, nodeHealthTier } from './nodeHealthScore';
import { MS_PER_HOUR } from './timeConstants';
import type { MeshNode } from './types';

export type MeshPeerGraphNodeKind = 'self' | 'relay' | 'peer';

export interface MeshPeerTopologyGraphNode {
  id: string;
  nodeId: number;
  label: string;
  kind: MeshPeerGraphNodeKind;
  depth: number;
  hops?: number | null;
  tier: NodeHealthTier;
  online: boolean;
  isHub: boolean;
  hubOutDegree: number;
  seedX: number;
  seedY: number;
}

export interface MeshPeerTopologyGraph {
  nodes: MeshPeerTopologyGraphNode[];
  edges: ForceEdge[];
  hiddenCount: number;
  totalNodeCount: number;
  relayCount: number;
}

export interface MeshPeerTopologyFilterOptions {
  /** When true (default), include multi-hop peers reachable via relay attachment. */
  includeDistantPeers?: boolean;
  /** When set, hide peers whose hop count exceeds this value. */
  maxHops?: number | null;
}

export interface BuildMeshPeerTopologyGraphOptions {
  myNodeId: number;
  selfLabel: string;
  cx?: number;
  cy?: number;
  filter?: MeshPeerTopologyFilterOptions;
  nowMs?: number;
}

const MAX_VISIBLE_NODES = 90;
export const MESH_PEER_UNASSIGNED_RELAY_ID = -1;

function effectiveHops(node: MeshNode): number | null {
  const hops = node.hops_away ?? node.hops;
  return hops != null && Number.isFinite(hops) ? hops : null;
}

/** True when the node was heard recently or has a known hop count in the path table. */
export function isMeshPeerOnline(node: MeshNode, nowMs: number = Date.now()): boolean {
  const hops = effectiveHops(node);
  if (hops != null && hops >= 0) return true;
  const lastHeard = node.last_heard ?? 0;
  if (lastHeard <= 0) return false;
  return nowMs - lastHeard < MS_PER_HOUR;
}

function nodeLabel(node: MeshNode): string {
  return (
    node.short_name?.trim() || node.long_name?.trim() || `!${node.node_id.toString(16).slice(-4)}`
  );
}

/** Resolve the relay hub a distant peer should hang off, when possible. */
export function resolveMeshPeerRelayId(
  peer: MeshNode,
  nodes: ReadonlyMap<number, MeshNode>,
  myNodeId: number,
): number | null {
  if (peer.path?.length) {
    for (const hop of peer.path) {
      if (hop === myNodeId || hop === peer.node_id) continue;
      if (nodes.has(hop)) return hop;
    }
  }

  for (const [relayId, relay] of nodes) {
    if (relayId === myNodeId || relayId === peer.node_id) continue;
    const relayHops = effectiveHops(relay);
    if (relayHops != null && relayHops > 1) continue;
    if (relay.neighbors?.some((n) => n.nodeId === peer.node_id)) return relayId;
  }

  return null;
}

function filterMeshPeers(
  peers: readonly MeshNode[],
  opts?: MeshPeerTopologyFilterOptions,
): { visible: MeshNode[]; hiddenCount: number } {
  const includeDistant = opts?.includeDistantPeers !== false;
  const maxHops = opts?.maxHops ?? null;

  let filtered = peers.filter((peer) => {
    const hops = effectiveHops(peer);
    if (maxHops != null && hops != null && hops > maxHops) return false;
    if (!includeDistant && hops != null && hops > 1) return false;
    return true;
  });

  const peerBudget = Math.max(0, MAX_VISIBLE_NODES - 1);
  const hiddenCount = Math.max(0, filtered.length - peerBudget);
  if (filtered.length > peerBudget) {
    filtered = [...filtered]
      .sort((a, b) => (effectiveHops(a) ?? 99) - (effectiveHops(b) ?? 99))
      .slice(0, peerBudget);
  }

  return { visible: filtered, hiddenCount };
}

function seedMeshPeerPositions(
  myNodeId: number,
  relayIds: readonly number[],
  peersByRelay: ReadonlyMap<number, readonly MeshNode[]>,
  unassignedPeers: readonly MeshNode[],
  cx: number,
  cy: number,
): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>();
  positions.set(myNodeId, { x: cx, y: cy });

  const relayRadius = 130;
  const peerRadius = 250;
  const relayCount = relayIds.length + (unassignedPeers.length > 0 ? 1 : 0);
  let slot = 0;

  for (const relayId of relayIds) {
    const angle = (2 * Math.PI * slot) / Math.max(relayCount, 1) - Math.PI / 2;
    slot += 1;
    positions.set(relayId, {
      x: cx + relayRadius * Math.cos(angle),
      y: cy + relayRadius * Math.sin(angle),
    });

    const peers = peersByRelay.get(relayId) ?? [];
    const spread = Math.min(Math.PI / 2.5, peers.length * 0.12);
    peers.forEach((peer, j) => {
      const offset = peers.length <= 1 ? 0 : (j / (peers.length - 1) - 0.5) * spread;
      const peerAngle = angle + offset;
      positions.set(peer.node_id, {
        x: cx + peerRadius * Math.cos(peerAngle),
        y: cy + peerRadius * Math.sin(peerAngle),
      });
    });
  }

  if (unassignedPeers.length > 0) {
    const angle = (2 * Math.PI * slot) / Math.max(relayCount, 1) - Math.PI / 2;
    positions.set(MESH_PEER_UNASSIGNED_RELAY_ID, {
      x: cx + relayRadius * Math.cos(angle),
      y: cy + relayRadius * Math.sin(angle),
    });
    const spread = Math.min(Math.PI / 2.5, unassignedPeers.length * 0.12);
    unassignedPeers.forEach((peer, j) => {
      const offset =
        unassignedPeers.length <= 1 ? 0 : (j / (unassignedPeers.length - 1) - 0.5) * spread;
      const peerAngle = angle + offset;
      positions.set(peer.node_id, {
        x: cx + peerRadius * Math.cos(peerAngle),
        y: cy + peerRadius * Math.sin(peerAngle),
      });
    });
  }

  return positions;
}

function buildGraphNode(
  node: MeshNode,
  kind: MeshPeerGraphNodeKind,
  depth: number,
  hubOutDegree: number,
  positions: Map<number, { x: number; y: number }>,
  cx: number,
  cy: number,
  nowMs: number,
): MeshPeerTopologyGraphNode {
  const pos = positions.get(node.node_id) ?? { x: cx, y: cy };
  return {
    id: String(node.node_id),
    nodeId: node.node_id,
    label: nodeLabel(node),
    kind,
    depth,
    hops: effectiveHops(node),
    tier: nodeHealthTier(nodeHealthScore(node, nowMs).total),
    online: isMeshPeerOnline(node, nowMs),
    isHub: kind === 'relay',
    hubOutDegree,
    seedX: pos.x,
    seedY: pos.y,
  };
}

/**
 * Mesh-style peer graph: local node center → direct relay hubs → distant peers.
 * Mirrors the Reticulum topology policy (hub attachment + hop filters + node budget).
 */
export function buildMeshPeerTopologyGraph(
  nodes: ReadonlyMap<number, MeshNode>,
  opts: BuildMeshPeerTopologyGraphOptions,
): MeshPeerTopologyGraph {
  const cx = opts.cx ?? 400;
  const cy = opts.cy ?? 300;
  const myNodeId = opts.myNodeId;
  const nowMs = opts.nowMs ?? Date.now();
  const selfNode = nodes.get(myNodeId);

  const allPeers = [...nodes.values()].filter((n) => n.node_id !== myNodeId);
  const { visible: visiblePeers, hiddenCount } = filterMeshPeers(allPeers, opts.filter);

  const directPeers: MeshNode[] = [];
  const distantPeers: MeshNode[] = [];
  for (const peer of visiblePeers) {
    const hops = effectiveHops(peer);
    if (hops == null || hops <= 1) {
      directPeers.push(peer);
    } else {
      distantPeers.push(peer);
    }
  }

  const relayIdSet = new Set<number>(directPeers.map((p) => p.node_id));
  const peersByRelay = new Map<number, MeshNode[]>();
  const unassignedPeers: MeshNode[] = [];

  for (const peer of distantPeers) {
    const relayId = resolveMeshPeerRelayId(peer, nodes, myNodeId);
    if (relayId != null) {
      relayIdSet.add(relayId);
      if (!peersByRelay.has(relayId)) peersByRelay.set(relayId, []);
      peersByRelay.get(relayId)!.push(peer);
    } else {
      unassignedPeers.push(peer);
    }
  }

  const relayIds = [...relayIdSet].sort((a, b) => a - b);
  const positions = seedMeshPeerPositions(
    myNodeId,
    relayIds,
    peersByRelay,
    unassignedPeers,
    cx,
    cy,
  );

  const graphNodes: MeshPeerTopologyGraphNode[] = [
    {
      id: String(myNodeId),
      nodeId: myNodeId,
      label: opts.selfLabel,
      kind: 'self',
      depth: 0,
      tier: selfNode ? nodeHealthTier(nodeHealthScore(selfNode, nowMs).total) : 'good',
      online: true,
      isHub: false,
      hubOutDegree: relayIds.length + (unassignedPeers.length > 0 ? 1 : 0),
      seedX: positions.get(myNodeId)?.x ?? cx,
      seedY: positions.get(myNodeId)?.y ?? cy,
    },
  ];

  const forceEdges: ForceEdge[] = [];
  const visibleNodeIds = new Set<number>([myNodeId]);

  for (const relayId of relayIds) {
    const relayNode = nodes.get(relayId);
    if (!relayNode) continue;
    const childCount = peersByRelay.get(relayId)?.length ?? 0;
    graphNodes.push(buildGraphNode(relayNode, 'relay', 1, childCount, positions, cx, cy, nowMs));
    visibleNodeIds.add(relayId);
    forceEdges.push({
      source: String(myNodeId),
      target: String(relayId),
      kind: 'direct',
      springLength: 150,
    });
  }

  for (const peer of distantPeers) {
    graphNodes.push(buildGraphNode(peer, 'peer', 2, 0, positions, cx, cy, nowMs));
    visibleNodeIds.add(peer.node_id);

    const relayId = resolveMeshPeerRelayId(peer, nodes, myNodeId);
    const edgeSource =
      relayId != null && visibleNodeIds.has(relayId) ? String(relayId) : String(myNodeId);
    forceEdges.push({
      source: edgeSource,
      target: String(peer.node_id),
      kind: edgeSource === String(myNodeId) ? 'direct' : 'relay',
      springLength: edgeSource === String(myNodeId) ? 150 : 110,
    });
  }

  return {
    nodes: graphNodes,
    edges: forceEdges,
    hiddenCount,
    totalNodeCount: allPeers.length + 1,
    relayCount: relayIds.length,
  };
}
