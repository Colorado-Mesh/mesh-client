import type { ForceEdge } from '../forceDirectedGraphLayout';

export interface ReticulumTopologyNodeInput {
  destination_hash: string;
  display_name?: string | null;
  hops?: number | null;
  via_hash?: string | null;
  interface?: string | null;
  last_seen?: number | null;
}

export interface ReticulumTopologyInterfaceInput {
  id: string;
  name: string;
  type?: string;
  enabled: boolean;
  status: string;
}

export type ReticulumTopologyNodeKind = 'self' | 'interface' | 'peer';

const UNASSIGNED_INTERFACE_ID = '__unassigned__';
const INTERFACE_NODE_PREFIX = 'iface:';

export interface ReticulumTopologyEdgeInput {
  source: string;
  target: string;
}

export interface ReticulumTopologyGraphNode {
  id: string;
  label: string;
  kind: ReticulumTopologyNodeKind;
  depth: number;
  hops?: number | null;
  online: boolean;
  peerKind?: 'user' | 'server';
  interfaceType?: string | null;
  interfaceStatus?: string | null;
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

export interface ReticulumTopologyFilterOptions {
  /** When true (default), include multi-hop peers reachable via edge paths. */
  includeDistantPeers?: boolean;
  /** When set, hide peers whose reported hop count exceeds this value. */
  maxHops?: number | null;
}

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

/** Build edges from path-table `via_hash` when the API returns nodes but no edge list. */
export function buildReticulumViaHashEdges(
  peers: readonly ReticulumTopologyNodeInput[],
): ReticulumTopologyEdgeInput[] {
  const edges: ReticulumTopologyEdgeInput[] = [];
  const edgeKeys = new Set<string>();

  for (const peer of peers) {
    if (!peer.destination_hash) continue;
    const target = peer.destination_hash;
    const via = peer.via_hash?.trim();
    const source = via && via.length > 0 ? via : SELF_ID;
    const key = `${source}\0${target}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ source, target });
  }

  const hasIncoming = new Set(edges.map((edge) => edge.target));
  const viaSources = new Set(
    edges.filter((edge) => edge.source !== SELF_ID).map((edge) => edge.source),
  );
  for (const via of viaSources) {
    if (hasIncoming.has(via)) continue;
    const key = `${SELF_ID}\0${via}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ source: SELF_ID, target: via });
  }

  return edges;
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

/** When over MAX_VISIBLE_NODES, keep self, hubs, depth-1 peers, and edge-attached distant peers. */
export function filterReticulumVisibleNodeIds(
  allIds: readonly string[],
  depths: Map<string, number>,
  edges: ReticulumTopologyEdgeInput[],
  nodes: readonly ReticulumTopologyNodeInput[] = [],
  opts?: ReticulumTopologyFilterOptions,
): Set<string> {
  const includeDistant = opts?.includeDistantPeers !== false;
  const maxHops = opts?.maxHops ?? null;
  const hopsById = new Map(nodes.map((n) => [n.destination_hash, n.hops]));

  const passesHopsFilter = (id: string): boolean => {
    if (maxHops == null) return true;
    const hops = hopsById.get(id);
    if (hops == null) return true;
    return hops <= maxHops;
  };

  const filteredIds = allIds.filter(passesHopsFilter);

  if (filteredIds.length + 1 <= MAX_VISIBLE_NODES) {
    return new Set(filteredIds);
  }

  const visible = new Set<string>();
  for (const id of filteredIds) {
    if (isReticulumHubNode(id, edges)) {
      visible.add(id);
    } else if ((depths.get(id) ?? 99) === 1) {
      visible.add(id);
    }
  }

  if (includeDistant) {
    const adj = buildAdjacency(edges);
    const queue = [SELF_ID, ...visible];
    const visited = new Set<string>([SELF_ID, ...visible]);
    while (queue.length > 0 && visible.size < MAX_VISIBLE_NODES) {
      const current = queue.shift()!;
      for (const neighbor of adj.get(current) ?? []) {
        if (neighbor === SELF_ID || visited.has(neighbor)) continue;
        if (!filteredIds.includes(neighbor)) continue;
        visited.add(neighbor);
        visible.add(neighbor);
        queue.push(neighbor);
        if (visible.size >= MAX_VISIBLE_NODES) break;
      }
    }
  }

  return visible;
}

export interface BuildReticulumTopologyGraphOptions {
  selfLabel: string;
  cx?: number;
  cy?: number;
  filter?: ReticulumTopologyFilterOptions;
}

export interface BuildReticulumMeshTopologyGraphOptions extends BuildReticulumTopologyGraphOptions {
  /** Destination hashes announced as Nomad Network nodes (server icon). */
  serverPeerHashes?: ReadonlySet<string>;
  /** Label for peers whose path-table interface does not match a configured interface. */
  unassignedInterfaceLabel: string;
}

/** True when a configured interface is enabled and reporting an active link. */
export function isReticulumInterfaceOnline(iface: ReticulumTopologyInterfaceInput): boolean {
  const status = iface.status.trim().toLowerCase();
  return (
    iface.enabled &&
    (status === 'up' || status === 'connected' || status === 'online' || status === 'running')
  );
}

/** True when the peer row is present in the path table with hop data. */
export function isReticulumPeerOnline(peer: ReticulumTopologyNodeInput): boolean {
  if (peer.hops != null && peer.hops >= 1) return true;
  if (peer.last_seen != null && peer.last_seen > 0) return true;
  return false;
}

export function interfaceNodeId(ifaceId: string): string {
  return `${INTERFACE_NODE_PREFIX}${ifaceId}`;
}

/** Map a path-table interface label onto a configured interface id. */
export function matchPeerToInterfaceId(
  peerInterface: string | null | undefined,
  interfaces: readonly ReticulumTopologyInterfaceInput[],
): string | null {
  const needle = peerInterface?.trim();
  if (!needle) return null;
  const lower = needle.toLowerCase();
  for (const iface of interfaces) {
    if (iface.name.toLowerCase() === lower || iface.id.toLowerCase() === lower) {
      return iface.id;
    }
  }
  for (const iface of interfaces) {
    const name = iface.name.toLowerCase();
    if (name.includes(lower) || lower.includes(name)) {
      return iface.id;
    }
  }
  return null;
}

function filterMeshTopologyPeers(
  peers: readonly ReticulumTopologyNodeInput[],
  interfaceCount: number,
  opts?: ReticulumTopologyFilterOptions,
): { visible: ReticulumTopologyNodeInput[]; hiddenCount: number } {
  const includeDistant = opts?.includeDistantPeers !== false;
  const maxHops = opts?.maxHops ?? null;

  let filtered = peers.filter((peer) => {
    if (!peer.destination_hash) return false;
    if (maxHops != null && peer.hops != null && peer.hops > maxHops) return false;
    if (!includeDistant && peer.hops != null && peer.hops > 2) return false;
    return true;
  });

  const peerBudget = Math.max(0, MAX_VISIBLE_NODES - interfaceCount - 1);
  const hiddenCount = Math.max(0, filtered.length - peerBudget);
  if (filtered.length > peerBudget) {
    filtered = [...filtered].sort((a, b) => (a.hops ?? 99) - (b.hops ?? 99)).slice(0, peerBudget);
  }

  return { visible: filtered, hiddenCount };
}

function seedMeshNodePositions(
  interfaces: readonly ReticulumTopologyInterfaceInput[],
  peersByInterface: ReadonlyMap<string, readonly ReticulumTopologyNodeInput[]>,
  unassignedPeers: readonly ReticulumTopologyNodeInput[],
  cx: number,
  cy: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(SELF_ID, { x: cx, y: cy });

  const ifaceRadius = 130;
  const peerRadius = 250;
  const ifaceCount = interfaces.length + (unassignedPeers.length > 0 ? 1 : 0);
  let slot = 0;

  for (const iface of interfaces) {
    const angle = (2 * Math.PI * slot) / Math.max(ifaceCount, 1) - Math.PI / 2;
    slot += 1;
    const ix = cx + ifaceRadius * Math.cos(angle);
    const iy = cy + ifaceRadius * Math.sin(angle);
    positions.set(interfaceNodeId(iface.id), { x: ix, y: iy });

    const peers = peersByInterface.get(iface.id) ?? [];
    const spread = Math.min(Math.PI / 2.5, peers.length * 0.12);
    peers.forEach((peer, j) => {
      const offset = peers.length <= 1 ? 0 : (j / (peers.length - 1) - 0.5) * spread;
      const peerAngle = angle + offset;
      positions.set(peer.destination_hash, {
        x: cx + peerRadius * Math.cos(peerAngle),
        y: cy + peerRadius * Math.sin(peerAngle),
      });
    });
  }

  if (unassignedPeers.length > 0) {
    const angle = (2 * Math.PI * slot) / Math.max(ifaceCount, 1) - Math.PI / 2;
    positions.set(interfaceNodeId(UNASSIGNED_INTERFACE_ID), {
      x: cx + ifaceRadius * Math.cos(angle),
      y: cy + ifaceRadius * Math.sin(angle),
    });
    const spread = Math.min(Math.PI / 2.5, unassignedPeers.length * 0.12);
    unassignedPeers.forEach((peer, j) => {
      const offset =
        unassignedPeers.length <= 1 ? 0 : (j / (unassignedPeers.length - 1) - 0.5) * spread;
      const peerAngle = angle + offset;
      positions.set(peer.destination_hash, {
        x: cx + peerRadius * Math.cos(peerAngle),
        y: cy + peerRadius * Math.sin(peerAngle),
      });
    });
  }

  return positions;
}

/**
 * MeshChat-style topology: local identity center → configured interface spokes → path-table peers.
 * Peers attach to the interface named in the path table, not via-hash relay hubs.
 */
export function buildReticulumMeshTopologyGraph(
  interfaces: readonly ReticulumTopologyInterfaceInput[],
  peers: readonly ReticulumTopologyNodeInput[],
  opts: BuildReticulumMeshTopologyGraphOptions,
): ReticulumTopologyGraph {
  const cx = opts.cx ?? 400;
  const cy = opts.cy ?? 300;
  const serverHashes = opts.serverPeerHashes ?? new Set<string>();

  const seen = new Set<string>();
  const uniquePeers = peers.filter((peer) => {
    if (!peer.destination_hash || seen.has(peer.destination_hash)) return false;
    seen.add(peer.destination_hash);
    return true;
  });

  const interfaceRows = [...interfaces];
  const { visible: visiblePeers, hiddenCount } = filterMeshTopologyPeers(
    uniquePeers,
    interfaceRows.length +
      (uniquePeers.some((p) => !matchPeerToInterfaceId(p.interface, interfaceRows)) ? 1 : 0),
    opts.filter,
  );

  const peersByInterface = new Map<string, ReticulumTopologyNodeInput[]>();
  const unassignedPeers: ReticulumTopologyNodeInput[] = [];
  for (const peer of visiblePeers) {
    const ifaceId = matchPeerToInterfaceId(peer.interface, interfaceRows);
    if (ifaceId) {
      if (!peersByInterface.has(ifaceId)) peersByInterface.set(ifaceId, []);
      peersByInterface.get(ifaceId)!.push(peer);
    } else {
      unassignedPeers.push(peer);
    }
  }

  const positions = seedMeshNodePositions(interfaceRows, peersByInterface, unassignedPeers, cx, cy);

  const graphNodes: ReticulumTopologyGraphNode[] = [
    {
      id: SELF_ID,
      label: opts.selfLabel,
      kind: 'self',
      depth: 0,
      online: true,
      isHub: false,
      hubOutDegree: interfaceRows.length + (unassignedPeers.length > 0 ? 1 : 0),
      seedX: positions.get(SELF_ID)?.x ?? cx,
      seedY: positions.get(SELF_ID)?.y ?? cy,
    },
  ];

  const forceEdges: ForceEdge[] = [];

  for (const iface of interfaceRows) {
    const nodeId = interfaceNodeId(iface.id);
    const peerCount = peersByInterface.get(iface.id)?.length ?? 0;
    const pos = positions.get(nodeId)!;
    graphNodes.push({
      id: nodeId,
      label: iface.name,
      kind: 'interface',
      depth: 1,
      online: isReticulumInterfaceOnline(iface),
      interfaceType: iface.type ?? null,
      interfaceStatus: iface.status ?? null,
      isHub: true,
      hubOutDegree: peerCount,
      seedX: pos.x,
      seedY: pos.y,
    });
    forceEdges.push({
      source: SELF_ID,
      target: nodeId,
      kind: 'direct',
      springLength: 150,
    });
  }

  if (unassignedPeers.length > 0) {
    const nodeId = interfaceNodeId(UNASSIGNED_INTERFACE_ID);
    const pos = positions.get(nodeId)!;
    graphNodes.push({
      id: nodeId,
      label: opts.unassignedInterfaceLabel,
      kind: 'interface',
      depth: 1,
      online: false,
      isHub: true,
      hubOutDegree: unassignedPeers.length,
      seedX: pos.x,
      seedY: pos.y,
    });
    forceEdges.push({
      source: SELF_ID,
      target: nodeId,
      kind: 'direct',
      springLength: 150,
    });
  }

  for (const peer of visiblePeers) {
    const hash = peer.destination_hash;
    const pos = positions.get(hash)!;
    const ifaceId =
      matchPeerToInterfaceId(peer.interface, interfaceRows) ?? UNASSIGNED_INTERFACE_ID;
    const peerKind = serverHashes.has(hash.toLowerCase()) ? 'server' : 'user';
    graphNodes.push({
      id: hash,
      label: peer.display_name?.trim() || hash.slice(0, 8),
      kind: 'peer',
      depth: 2,
      hops: peer.hops,
      online: isReticulumPeerOnline(peer),
      peerKind,
      isHub: false,
      hubOutDegree: 0,
      seedX: pos.x,
      seedY: pos.y,
    });
    forceEdges.push({
      source: interfaceNodeId(ifaceId),
      target: hash,
      kind: 'relay',
      springLength: 110,
    });
  }

  return {
    nodes: graphNodes,
    edges: forceEdges,
    hiddenCount,
    totalNodeCount: uniquePeers.length + interfaceRows.length + 1,
  };
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
  const visibleIds = filterReticulumVisibleNodeIds(
    allPeerIds,
    depths,
    edges,
    uniqueNodes,
    opts.filter,
  );
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
      kind: 'self',
      depth: 0,
      online: true,
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
      const isHub = isReticulumHubNode(node.destination_hash, edges);
      graphNodes.push({
        id: node.destination_hash,
        label: node.display_name ?? node.destination_hash.slice(0, 8),
        kind: isHub ? 'interface' : 'peer',
        depth,
        hops: node.hops,
        online: isReticulumPeerOnline(node),
        isHub,
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
