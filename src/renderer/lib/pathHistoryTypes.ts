export interface PathRecord {
  id?: number;
  nodeId: number;
  /** Hex-encoded hash of pathBytes; used as dedup key per contact. */
  pathHash: string;
  hopCount: number;
  pathBytes: number[];
  wasFloodDiscovery: boolean;
  successCount: number;
  failureCount: number;
  /** Fastest observed round-trip time in ms for this path (0 = unknown). */
  tripTimeMs: number;
  /** Weight assigned by the radio/firmware when this path was discovered (default 1.0). */
  routeWeight: number;
  lastSuccessTs: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PathSelection {
  pathBytes: number[];
  hopCount: number;
  pathHash: string;
  useFlood: boolean;
}

/** Weighted route score components (each in [0, 1]). */
export interface PathScore {
  reliability: number;
  latency: number;
  freshness: number;
  routeWeight: number;
  total: number;
}
