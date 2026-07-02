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
  /** Direct peers demoted from relay hub to reduce center starburst clutter. */
  demotedDirectCount: number;
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

/** Default visible node budget — tuned for readable force layout without label pile-up. */
export const MESH_PEER_MAX_VISIBLE_NODES = 48;
/** Max relay hubs with thick self spokes; excess direct peers render as compact leaf dots. */
export const MESH_PEER_MAX_RELAY_HUBS = 20;
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

/**
 * Prefer RF/neighbor evidence for relay hub promotion. MQTT-only nodes at 0 hops are
 * usually heard via the broker, not direct RF neighbors — promoting all of them causes
 * the center starburst seen on large Meshtastic maps.
 */
export function isMeshRelayHubCandidate(node: MeshNode, distantChildCount: number): boolean {
  if (distantChildCount > 0) return true;
  if ((node.neighbors?.length ?? 0) > 0) return true;
  if (node.source === 'rf' && !node.heard_via_mqtt_only) return true;
  const hops = effectiveHops(node);
  if (hops === 1 && node.source !== 'mqtt') return true;
  return false;
}

function relayHubScore(node: MeshNode, distantChildCount: number, nowMs: number): number {
  const health = nodeHealthScore(node, nowMs).total;
  const recency =
    node.last_heard != null && node.last_heard > 0
      ? Math.max(0, 100 - (nowMs - node.last_heard) / MS_PER_HOUR)
      : 0;
  return distantChildCount * 10_000 + health * 10 + recency;
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

  const peerBudget = Math.max(0, MESH_PEER_MAX_VISIBLE_NODES - 1);
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
  leafDirectPeers: readonly MeshNode[],
  unassignedPeers: readonly MeshNode[],
  cx: number,
  cy: number,
): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>();
  positions.set(myNodeId, { x: cx, y: cy });

  const hubCount = relayIds.length + (unassignedPeers.length > 0 ? 1 : 0);
  const relayRadius = 120 + Math.min(100, hubCount * 4);
  const peerRadius = relayRadius + 100 + Math.min(80, hubCount * 2);
  const leafRadius = peerRadius + 60;
  let slot = 0;

  for (const relayId of relayIds) {
    const angle = (2 * Math.PI * slot) / Math.max(hubCount, 1) - Math.PI / 2;
    slot += 1;
    positions.set(relayId, {
      x: cx + relayRadius * Math.cos(angle),
      y: cy + relayRadius * Math.sin(angle),
    });

    const peers = peersByRelay.get(relayId) ?? [];
    const spread = Math.min(Math.PI / 1.8, Math.max(0.25, peers.length * 0.18));
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
    const angle = (2 * Math.PI * slot) / Math.max(hubCount, 1) - Math.PI / 2;
    positions.set(MESH_PEER_UNASSIGNED_RELAY_ID, {
      x: cx + relayRadius * Math.cos(angle),
      y: cy + relayRadius * Math.sin(angle),
    });
    const spread = Math.min(Math.PI / 1.8, Math.max(0.25, unassignedPeers.length * 0.18));
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

  if (leafDirectPeers.length > 0) {
    leafDirectPeers.forEach((peer, j) => {
      const angle = (2 * Math.PI * j) / leafDirectPeers.length - Math.PI / 2;
      positions.set(peer.node_id, {
        x: cx + leafRadius * Math.cos(angle),
        y: cy + leafRadius * Math.sin(angle),
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
 * Relay hubs are capped so large MQTT node maps do not starburst every leaf from center.
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

  const peersByRelay = new Map<number, MeshNode[]>();
  const unassignedPeers: MeshNode[] = [];

  for (const peer of distantPeers) {
    const relayId = resolveMeshPeerRelayId(peer, nodes, myNodeId);
    if (relayId != null) {
      if (!peersByRelay.has(relayId)) peersByRelay.set(relayId, []);
      peersByRelay.get(relayId)!.push(peer);
    } else {
      unassignedPeers.push(peer);
    }
  }

  const relayCandidates = new Map<number, number>();
  for (const peer of directPeers) {
    relayCandidates.set(peer.node_id, peersByRelay.get(peer.node_id)?.length ?? 0);
  }
  for (const relayId of peersByRelay.keys()) {
    relayCandidates.set(relayId, peersByRelay.get(relayId)?.length ?? 0);
  }

  const rankedRelayIds = [...relayCandidates.entries()]
    .filter(([id, childCount]) => {
      const node = nodes.get(id);
      return node != null && isMeshRelayHubCandidate(node, childCount);
    })
    .sort((a, b) => {
      const nodeA = nodes.get(a[0])!;
      const nodeB = nodes.get(b[0])!;
      return relayHubScore(nodeB, b[1], nowMs) - relayHubScore(nodeA, a[1], nowMs);
    })
    .map(([id]) => id);

  const relayIds = rankedRelayIds.slice(0, MESH_PEER_MAX_RELAY_HUBS);
  const relayIdSet = new Set(relayIds);
  const demotedDirectPeers = directPeers.filter((p) => !relayIdSet.has(p.node_id));

  const positions = seedMeshPeerPositions(
    myNodeId,
    relayIds,
    peersByRelay,
    demotedDirectPeers,
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
      hubOutDegree: relayIds.length,
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
      springLength: 160,
    });
  }

  for (const peer of demotedDirectPeers) {
    graphNodes.push(buildGraphNode(peer, 'peer', 1, 0, positions, cx, cy, nowMs));
    visibleNodeIds.add(peer.node_id);
    forceEdges.push({
      source: String(myNodeId),
      target: String(peer.node_id),
      kind: 'relay',
      springLength: 200,
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
      kind: edgeSource === String(myNodeId) ? 'relay' : 'relay',
      springLength: edgeSource === String(myNodeId) ? 200 : 120,
    });
  }

  return {
    nodes: graphNodes,
    edges: forceEdges,
    hiddenCount,
    totalNodeCount: allPeers.length + 1,
    relayCount: relayIds.length,
    demotedDirectCount: demotedDirectPeers.length,
  };
}
