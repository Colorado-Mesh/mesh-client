import type { ForceEdge } from '../forceDirectedGraphLayout';

export interface ReticulumTopologyNodeInput {
  destination_hash: string;
  display_name?: string | null;
  hops?: number | null;
  via_hash?: string | null;
}

export interface ReticulumTopologyEdgeInput {
  source: string;
  target: string;
}

export interface ReticulumTopologyGraphNode {
  id: string;
  label: string;
  depth: number;
  hops?: number | null;
  isHub: boolean;
  hubOutDegree: number;
  seedX: number;
  seedY: number;
}

export interface ReticulumTopologyGraph {
  nodes: ReticulumTopologyGraphNode[];
  edges: ForceEdge[];
  hiddenCount: number;
  totalNodeCount: number;
}

/** Ring-layout node coordinates (legacy tests). */
export interface ReticulumTopologyLayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  depth: number;
  hops?: number | null;
  isRelay: boolean;
}

const SELF_ID = 'self';
const MAX_VISIBLE_NODES = 90;

function buildAdjacency(edges: ReticulumTopologyEdgeInput[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    if (!adj.has(from)) adj.set(from, new Set());
    adj.get(from)!.add(to);
  };
  for (const edge of edges) {
    add(edge.source, edge.target);
  }
  return adj;
}

/** BFS depth from self for layout. Unreachable nodes get depth 99. */
export function computeReticulumNodeDepths(
  edges: ReticulumTopologyEdgeInput[],
  nodes: readonly ReticulumTopologyNodeInput[],
): Map<string, number> {
  const nodeIds = nodes.map((n) => n.destination_hash);
  const adj = buildAdjacency(edges);
  const depths = new Map<string, number>();
  depths.set(SELF_ID, 0);
  const queue: string[] = [SELF_ID];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextDepth = (depths.get(current) ?? 0) + 1;
    for (const neighbor of adj.get(current) ?? []) {
      if (depths.has(neighbor)) continue;
      depths.set(neighbor, nextDepth);
      queue.push(neighbor);
    }
  }
  const hopsById = new Map(nodes.map((n) => [n.destination_hash, n.hops]));
  for (const id of nodeIds) {
    if (depths.has(id)) continue;
    const hops = hopsById.get(id);
    if (hops != null && hops > 0) {
      depths.set(id, hops);
    } else {
      depths.set(id, 99);
    }
  }
  return depths;
}

/** Count outgoing edges from a node (relay fan-out). */
export function countRelayTargets(nodeId: string, edges: ReticulumTopologyEdgeInput[]): number {
  return edges.filter((e) => e.source === nodeId).length;
}

/** Hub = non-self node that relays traffic (source of at least one edge). */
export function isReticulumHubNode(nodeId: string, edges: ReticulumTopologyEdgeInput[]): boolean {
  return nodeId !== SELF_ID && countRelayTargets(nodeId, edges) > 0;
}

/** Merge relay stub ids from edges into the node list so graph lines can render. */
export function mergeReticulumTopologyEdgeNodes(
  nodes: ReticulumTopologyNodeInput[],
  edges: ReticulumTopologyEdgeInput[],
): ReticulumTopologyNodeInput[] {
  const byHash = new Map(nodes.map((n) => [n.destination_hash, n]));
  for (const edge of edges) {
    for (const id of [edge.source, edge.target]) {
      if (id === SELF_ID || byHash.has(id)) continue;
      byHash.set(id, { destination_hash: id, display_name: null, hops: null });
    }
  }
  return [...byHash.values()];
}

/** Star fallback misrepresents multi-hop when via/hops data exists but edges are empty. */
export function shouldUseReticulumStarFallbackEdges(
  peers: readonly ReticulumTopologyNodeInput[],
  edges: readonly ReticulumTopologyEdgeInput[],
): boolean {
  if (edges.length > 0) return false;
  return !peers.some(
    (peer) =>
      (peer.hops != null && peer.hops > 1) || (peer.via_hash != null && peer.via_hash.length > 0),
  );
}

export function buildReticulumStarFallbackEdges(
  peers: ReticulumTopologyNodeInput[],
): ReticulumTopologyEdgeInput[] {
  return peers.map((peer) => ({ source: SELF_ID, target: peer.destination_hash }));
}

function classifyForceEdge(edge: ReticulumTopologyEdgeInput): ForceEdge['kind'] {
  if (edge.source === SELF_ID) return 'direct';
  return 'relay';
}

function seedPositionForDepth(
  depth: number,
  index: number,
  ringSize: number,
  cx: number,
  cy: number,
  maxDepth: number,
): { x: number; y: number } {
  if (depth <= 0) return { x: cx, y: cy };
  const effectiveDepth = depth >= 99 ? maxDepth + 1 : depth;
  const radius = Math.max(70, Math.min(280, 50 + effectiveDepth * (220 / Math.max(maxDepth, 1))));
  const angle = (2 * Math.PI * index) / Math.max(ringSize, 1);
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

/** When over MAX_VISIBLE_NODES, keep self, all hubs, and depth-1 peers; hide distant leaves. */
export function filterReticulumVisibleNodeIds(
  allIds: readonly string[],
  depths: Map<string, number>,
  edges: ReticulumTopologyEdgeInput[],
): Set<string> {
  if (allIds.length + 1 <= MAX_VISIBLE_NODES) {
    return new Set(allIds);
  }
  const visible = new Set<string>();
  for (const id of allIds) {
    if (isReticulumHubNode(id, edges)) {
      visible.add(id);
    } else if ((depths.get(id) ?? 99) === 1) {
      visible.add(id);
    }
  }
  return visible;
}

export interface BuildReticulumTopologyGraphOptions {
  selfLabel: string;
  cx?: number;
  cy?: number;
}

export function buildReticulumTopologyGraph(
  nodes: ReticulumTopologyNodeInput[],
  edges: ReticulumTopologyEdgeInput[],
  opts: BuildReticulumTopologyGraphOptions,
): ReticulumTopologyGraph {
  const cx = opts.cx ?? 400;
  const cy = opts.cy ?? 300;
  const mergedNodes = mergeReticulumTopologyEdgeNodes(nodes, edges);
  const seen = new Set<string>();
  const uniqueNodes = mergedNodes.filter((n) => {
    if (!n.destination_hash || seen.has(n.destination_hash)) return false;
    seen.add(n.destination_hash);
    return true;
  });

  const depths = computeReticulumNodeDepths(edges, uniqueNodes);
  const allPeerIds = uniqueNodes.map((n) => n.destination_hash);
  const visibleIds = filterReticulumVisibleNodeIds(allPeerIds, depths, edges);
  const hiddenCount = allPeerIds.filter((id) => !visibleIds.has(id)).length;

  const byDepth = new Map<number, ReticulumTopologyNodeInput[]>();
  for (const node of uniqueNodes) {
    if (!visibleIds.has(node.destination_hash)) continue;
    const depth = depths.get(node.destination_hash) ?? 99;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(node);
  }

  const depthKeys = [...byDepth.keys()].filter((d) => d > 0).sort((a, b) => a - b);
  const finiteDepths = depthKeys.filter((d) => d < 99);
  const maxDepth = finiteDepths.length > 0 ? Math.max(...finiteDepths) : 1;

  const graphNodes: ReticulumTopologyGraphNode[] = [
    {
      id: SELF_ID,
      label: opts.selfLabel,
      depth: 0,
      isHub: false,
      hubOutDegree: 0,
      seedX: cx,
      seedY: cy,
    },
  ];

  for (const depth of depthKeys) {
    const ringNodes = byDepth.get(depth) ?? [];
    ringNodes.forEach((node, i) => {
      const { x, y } = seedPositionForDepth(depth, i, ringNodes.length, cx, cy, maxDepth);
      const outDegree = countRelayTargets(node.destination_hash, edges);
      graphNodes.push({
        id: node.destination_hash,
        label: node.display_name ?? node.destination_hash.slice(0, 8),
        depth,
        hops: node.hops,
        isHub: isReticulumHubNode(node.destination_hash, edges),
        hubOutDegree: outDegree,
        seedX: x,
        seedY: y,
      });
    });
  }

  const visibleSet = new Set(graphNodes.map((n) => n.id));
  const forceEdges: ForceEdge[] = edges
    .filter((e) => visibleSet.has(e.source) && visibleSet.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      kind: classifyForceEdge(e),
    }));

  return {
    nodes: graphNodes,
    edges: forceEdges,
    hiddenCount,
    totalNodeCount: allPeerIds.length + 1,
  };
}

export interface BuildReticulumTopologyLayoutOptions {
  selfLabel: string;
  cx?: number;
  cy?: number;
}

/** Ring layout (legacy); prefer buildReticulumTopologyGraph for force-directed UI. */
export function buildReticulumTopologyLayout(
  nodes: ReticulumTopologyNodeInput[],
  edges: ReticulumTopologyEdgeInput[],
  opts: BuildReticulumTopologyLayoutOptions,
): ReticulumTopologyLayoutNode[] {
  const graph = buildReticulumTopologyGraph(nodes, edges, opts);
  return graph.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    x: n.seedX,
    y: n.seedY,
    depth: n.depth,
    hops: n.hops,
    isRelay: n.isHub,
  }));
}
