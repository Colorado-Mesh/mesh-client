export interface ReticulumTopologyNodeInput {
  destination_hash: string;
  display_name?: string | null;
  hops?: number | null;
}

export interface ReticulumTopologyEdgeInput {
  source: string;
  target: string;
}

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

/** BFS depth from self for ring layout. Unreachable nodes get depth 99. */
export function computeReticulumNodeDepths(
  edges: ReticulumTopologyEdgeInput[],
  nodeIds: Iterable<string>,
): Map<string, number> {
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
  for (const id of nodeIds) {
    if (!depths.has(id)) depths.set(id, 99);
  }
  return depths;
}

/** Count how many edges use this node as a relay (via) source. */
export function countRelayTargets(nodeId: string, edges: ReticulumTopologyEdgeInput[]): number {
  return edges.filter((e) => e.source === nodeId).length;
}

export interface BuildReticulumTopologyLayoutOptions {
  selfLabel: string;
  cx?: number;
  cy?: number;
}

export function buildReticulumTopologyLayout(
  nodes: ReticulumTopologyNodeInput[],
  edges: ReticulumTopologyEdgeInput[],
  opts: BuildReticulumTopologyLayoutOptions,
): ReticulumTopologyLayoutNode[] {
  const cx = opts.cx ?? 200;
  const cy = opts.cy ?? 160;
  const seen = new Set<string>();
  const uniqueNodes = nodes.filter((n) => {
    if (!n.destination_hash || seen.has(n.destination_hash)) return false;
    seen.add(n.destination_hash);
    return true;
  });

  const nodeIds = uniqueNodes.map((n) => n.destination_hash);
  const depths = computeReticulumNodeDepths(edges, nodeIds);
  const byDepth = new Map<number, ReticulumTopologyNodeInput[]>();
  for (const node of uniqueNodes) {
    const depth = depths.get(node.destination_hash) ?? 99;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(node);
  }

  const rendered: ReticulumTopologyLayoutNode[] = [
    {
      id: SELF_ID,
      label: opts.selfLabel,
      x: cx,
      y: cy,
      depth: 0,
      isRelay: false,
    },
  ];

  const depthKeys = [...byDepth.keys()].filter((d) => d > 0 && d < 99).sort((a, b) => a - b);
  const maxDepth = depthKeys.length > 0 ? Math.max(...depthKeys) : 1;

  for (const depth of depthKeys) {
    const ringNodes = byDepth.get(depth) ?? [];
    const radius = Math.max(60, Math.min(130, 40 + depth * (120 / Math.max(maxDepth, 1))));
    ringNodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(ringNodes.length, 1);
      rendered.push({
        id: node.destination_hash,
        label: node.display_name ?? node.destination_hash.slice(0, 8),
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        depth,
        hops: node.hops,
        isRelay: countRelayTargets(node.destination_hash, edges) > 1,
      });
    });
  }

  const unreachable = byDepth.get(99) ?? [];
  if (unreachable.length > 0) {
    const radius = 150;
    unreachable.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(unreachable.length, 1);
      rendered.push({
        id: node.destination_hash,
        label: node.display_name ?? node.destination_hash.slice(0, 8),
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        depth: 99,
        hops: node.hops,
        isRelay: countRelayTargets(node.destination_hash, edges) > 1,
      });
    });
  }

  return rendered;
}

export function buildReticulumStarFallbackEdges(
  peers: ReticulumTopologyNodeInput[],
): ReticulumTopologyEdgeInput[] {
  return peers.map((peer) => ({ source: SELF_ID, target: peer.destination_hash }));
}
