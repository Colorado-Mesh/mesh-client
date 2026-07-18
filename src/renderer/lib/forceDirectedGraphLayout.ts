export const FORCE_GRAPH_DEFAULTS = {
  repulsion: 8000,
  springLenDirect: 140,
  springLenRelay: 220,
  springK: 0.06,
  damping: 0.6,
  maxV: 8,
  renderEvery: 2,
  nodePadding: 18,
  centerPull: 0.003,
} as const;

export interface SimNodeState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ForceEdge {
  source: string;
  target: string;
  springLength?: number;
  kind?: 'direct' | 'relay';
}

export function springLengthForEdge(edge: ForceEdge): number {
  if (edge.springLength != null) return edge.springLength;
  return edge.kind === 'relay'
    ? FORCE_GRAPH_DEFAULTS.springLenRelay
    : FORCE_GRAPH_DEFAULTS.springLenDirect;
}

/** Above this count, use a uniform grid neighbor pass instead of all-pairs repulsion. */
export const FORCE_REPULSION_FULL_PAIR_CAP = 400;
const GRID_CELL = 80;

function applyPairRepulsion(
  nodes: SimNodeState[],
  fx: Float64Array,
  fy: Float64Array,
  i: number,
  j: number,
): void {
  const dx = nodes[j].x - nodes[i].x || 0.01;
  const dy = nodes[j].y - nodes[i].y || 0.01;
  const distSq = Math.max(1, dx * dx + dy * dy);
  const dist = Math.sqrt(distSq);
  const force = FORCE_GRAPH_DEFAULTS.repulsion / distSq;
  fx[i] -= (force * dx) / dist;
  fy[i] -= (force * dy) / dist;
  fx[j] += (force * dx) / dist;
  fy[j] += (force * dy) / dist;
}

function applyAllPairsRepulsion(nodes: SimNodeState[], fx: Float64Array, fy: Float64Array): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      applyPairRepulsion(nodes, fx, fy, i, j);
    }
  }
}

/** O(n · k) approximate repulsion via neighboring grid cells. */
function applyGridRepulsion(nodes: SimNodeState[], fx: Float64Array, fy: Float64Array): void {
  const cells = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    const cx = Math.floor(nodes[i].x / GRID_CELL);
    const cy = Math.floor(nodes[i].y / GRID_CELL);
    const key = `${cx},${cy}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  }
  for (let i = 0; i < nodes.length; i++) {
    const cx = Math.floor(nodes[i].x / GRID_CELL);
    const cy = Math.floor(nodes[i].y / GRID_CELL);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = cells.get(`${cx + ox},${cy + oy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          applyPairRepulsion(nodes, fx, fy, i, j);
        }
      }
    }
  }
}

/** One physics tick: mutates node positions in place. */
export function stepForceSimulation(
  nodes: SimNodeState[],
  edges: ForceEdge[],
  width: number,
  height: number,
  nodePadding: number = FORCE_GRAPH_DEFAULTS.nodePadding,
): void {
  if (nodes.length === 0) return;

  const fx = new Float64Array(nodes.length);
  const fy = new Float64Array(nodes.length);
  const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));

  if (nodes.length <= FORCE_REPULSION_FULL_PAIR_CAP) {
    applyAllPairsRepulsion(nodes, fx, fy);
  } else {
    applyGridRepulsion(nodes, fx, fy);
  }

  for (const edge of edges) {
    const si = idToIndex.get(edge.source);
    const ti = idToIndex.get(edge.target);
    if (si == null || ti == null) continue;
    const dx = nodes[ti].x - nodes[si].x;
    const dy = nodes[ti].y - nodes[si].y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const targetLen = springLengthForEdge(edge);
    const force = FORCE_GRAPH_DEFAULTS.springK * (dist - targetLen);
    fx[si] += (force * dx) / dist;
    fy[si] += (force * dy) / dist;
    fx[ti] -= (force * dx) / dist;
    fy[ti] -= (force * dy) / dist;
  }

  const cx = width / 2;
  const cy = height / 2;
  for (let i = 0; i < nodes.length; i++) {
    fx[i] += (cx - nodes[i].x) * FORCE_GRAPH_DEFAULTS.centerPull;
    fy[i] += (cy - nodes[i].y) * FORCE_GRAPH_DEFAULTS.centerPull;
  }

  const { damping, maxV } = FORCE_GRAPH_DEFAULTS;
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].vx = Math.max(-maxV, Math.min(maxV, (nodes[i].vx + fx[i]) * damping));
    nodes[i].vy = Math.max(-maxV, Math.min(maxV, (nodes[i].vy + fy[i]) * damping));
    nodes[i].x = Math.max(nodePadding, Math.min(width - nodePadding, nodes[i].x + nodes[i].vx));
    nodes[i].y = Math.max(nodePadding, Math.min(height - nodePadding, nodes[i].y + nodes[i].vy));
  }
}

export interface ForceSimulationLoopParams {
  getSimNodes: () => SimNodeState[];
  getEdges: () => ForceEdge[];
  getDimensions: () => { width: number; height: number };
  onFrame: (nodes: SimNodeState[], edges: ForceEdge[]) => void;
  nodePadding?: number;
}

/** Runs rAF physics loop; returns cleanup. */
export function startForceSimulationLoop(params: ForceSimulationLoopParams): () => void {
  let running = true;
  let frame = 0;
  let animId: number | null = null;

  function tick() {
    if (!running) return;
    const ns = params.getSimNodes();
    const es = params.getEdges();
    const { width, height } = params.getDimensions();
    if (ns.length > 0) {
      stepForceSimulation(ns, es, width, height, params.nodePadding);
    }
    frame++;
    if (frame % FORCE_GRAPH_DEFAULTS.renderEvery === 0) {
      params.onFrame(ns, es);
    }
    animId = requestAnimationFrame(tick);
  }

  animId = requestAnimationFrame(tick);
  return () => {
    running = false;
    if (animId != null) cancelAnimationFrame(animId);
  };
}
