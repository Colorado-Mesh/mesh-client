/**
 * MeshCom gateway/network UTC (or CET) beacon text — ~every 5 minutes on the mesh.
 * dg9vh MeshCom-Client treats inbound EXTUDP `msg` bodies containing `{CET}` as net time
 * (not chat) and shows them as a mesh-liveness indicator.
 */
const NETWORK_TIME_TAG = '{CET}';

export interface MeshcomNetworkTimeSnapshot {
  text: string;
  heardAtMs: number;
}

let cached: MeshcomNetworkTimeSnapshot | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Firmware matches `memcmp(payload, "{CET}", 5)` — prefix only, not mid-message substrings. */
export function isMeshcomNetworkTimeBeacon(text: string): boolean {
  return text.startsWith(NETWORK_TIME_TAG);
}

/** Parse and record network-time payload; returns true when the text was a net-time beacon. */
export function noteMeshcomNetworkTimeFromText(text: string): boolean {
  if (!isMeshcomNetworkTimeBeacon(text)) return false;
  const rest = text.slice(NETWORK_TIME_TAG.length).trim();
  cached = {
    text: rest || text.trim(),
    heardAtMs: Date.now(),
  };
  notify();
  return true;
}

/** Stable snapshot for `useSyncExternalStore` (same reference until a new beacon). */
export function getMeshcomNetworkTime(): MeshcomNetworkTimeSnapshot | null {
  return cached;
}

export function subscribeMeshcomNetworkTime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper. */
export function resetMeshcomNetworkTimeForTests(): void {
  cached = null;
  listeners.clear();
}
