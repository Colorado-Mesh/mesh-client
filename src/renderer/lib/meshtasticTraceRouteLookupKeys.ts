/** Stored traceroute row for the node detail modal / diagnostics */
export interface MeshtasticTraceRouteEntry {
  route: number[];
  from: number;
  timestamp: number;
}

/** Merge one RouteDiscovery-derived result into the per-node lookup map (RF or MQTT). */
export function mergeMeshtasticTraceRouteIntoResultsMap(
  prev: Map<number, MeshtasticTraceRouteEntry>,
  meshFrom: number,
  rd: { route: readonly number[]; routeBack: readonly number[] },
  dataLayerDest: number | undefined,
): Map<number, MeshtasticTraceRouteEntry> {
  const route = rd.route != null ? [...rd.route] : [];
  const entry: MeshtasticTraceRouteEntry = {
    route,
    from: meshFrom,
    timestamp: Date.now(),
  };
  const lookupKeys = meshtasticTraceRouteLookupKeys({
    from: meshFrom,
    data: { route: rd.route, routeBack: rd.routeBack },
    dataLayerDest,
  });
  const next = new Map(prev);
  for (const k of lookupKeys) {
    next.set(k, entry);
  }
  return next;
}

/**
 * Meshtastic traceroute replies use MeshPacket `from` = RF sender of the reply, which may
 * differ from the node the user asked to trace. The Data-layer `dest` field (protobuf:
 * "RouteDiscovery messages _must_ populate this") is the queried node. Route entries list
 * intermediate hops — include all for lookup.
 */
export function meshtasticTraceRouteLookupKeys(packet: {
  from: number;
  data: { route?: readonly number[]; routeBack?: readonly number[] };
  /** From `meshtastic.Data.dest` on the decoded wrapper (not inside RouteDiscovery payload). */
  dataLayerDest?: number;
}): number[] {
  const route = packet.data.route ?? [];
  const routeBack = packet.data.routeBack ?? [];
  const keys = new Set<number>([packet.from >>> 0]);
  for (const id of route) keys.add(id >>> 0);
  for (const id of routeBack) keys.add(id >>> 0);
  if (route.length > 0) keys.add(route[route.length - 1] >>> 0);
  if (routeBack.length > 0) keys.add(routeBack[0] >>> 0);
  const d = packet.dataLayerDest;
  if (d !== undefined) {
    const u = d >>> 0;
    if (u !== 0 && u !== 0xffffffff) keys.add(u);
  }
  return [...keys];
}
