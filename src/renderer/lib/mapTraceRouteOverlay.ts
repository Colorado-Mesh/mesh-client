/**
 * Build map polyline / hop markers from a Meshtastic/MeshCore traceroute result
 * and known node positions.
 */
export interface TraceRouteOverlayHop {
  nodeId: number;
  label: string;
  lat: number;
  lon: number;
}

export interface TraceRouteOverlay {
  hops: TraceRouteOverlayHop[];
  /**
   * Consecutive positioned segments (each length ≥ 2). Missing intermediate
   * positions break the polyline instead of bridging surrounding hops.
   */
  segments: [number, number][][];
  /** True when at least one consecutive positioned segment exists. */
  hasPolyline: boolean;
  /** True when the route has hops but none have map positions. */
  emptyBecauseMissingPositions: boolean;
}

export interface TraceRouteOverlayInput {
  /** Hop node ids in order (including self / destination when known). */
  routeNodeIds: readonly number[];
  hopLabels?: readonly string[];
  positions: ReadonlyMap<number, { lat: number; lon: number } | null | undefined>;
}

function isUsablePosition(pos: { lat: number; lon: number } | null | undefined): pos is {
  lat: number;
  lon: number;
} {
  if (pos == null || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return false;
  if (pos.lat === 0 && pos.lon === 0) return false;
  return true;
}

/** Collect positioned hops for map display; empty-state when positions are missing. */
export function buildTraceRouteOverlay(input: TraceRouteOverlayInput): TraceRouteOverlay {
  const hops: TraceRouteOverlayHop[] = [];
  const segments: [number, number][][] = [];
  let currentSegment: [number, number][] = [];

  const flushSegment = () => {
    if (currentSegment.length >= 2) segments.push(currentSegment);
    currentSegment = [];
  };

  for (let i = 0; i < input.routeNodeIds.length; i += 1) {
    const nodeId = input.routeNodeIds[i];
    const pos = input.positions.get(nodeId);
    if (!isUsablePosition(pos)) {
      flushSegment();
      continue;
    }
    hops.push({
      nodeId,
      label: input.hopLabels?.[i] ?? String(nodeId),
      lat: pos.lat,
      lon: pos.lon,
    });
    currentSegment.push([pos.lat, pos.lon]);
  }
  flushSegment();

  const emptyBecauseMissingPositions = input.routeNodeIds.length > 0 && hops.length === 0;
  return {
    hops,
    segments,
    hasPolyline: segments.length > 0,
    emptyBecauseMissingPositions,
  };
}
