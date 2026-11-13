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
  /** True when at least two consecutive positions exist for a polyline. */
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

/** Collect positioned hops for map display; empty-state when positions are missing. */
export function buildTraceRouteOverlay(input: TraceRouteOverlayInput): TraceRouteOverlay {
  const hops: TraceRouteOverlayHop[] = [];
  for (let i = 0; i < input.routeNodeIds.length; i += 1) {
    const nodeId = input.routeNodeIds[i];
    const pos = input.positions.get(nodeId);
    if (pos == null || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) continue;
    if (pos.lat === 0 && pos.lon === 0) continue;
    hops.push({
      nodeId,
      label: input.hopLabels?.[i] ?? String(nodeId),
      lat: pos.lat,
      lon: pos.lon,
    });
  }
  const emptyBecauseMissingPositions = input.routeNodeIds.length > 0 && hops.length === 0;
  return {
    hops,
    hasPolyline: hops.length >= 2,
    emptyBecauseMissingPositions,
  };
}
