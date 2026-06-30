/** Map Reticulum destination hash strings to numeric node_id for shared stores. */
export function reticulumHashToNodeId(hash: string): number {
  const hex = hash.replace(/[^0-9a-f]/gi, '').slice(0, 12);
  const parsed = Number.parseInt(hex || '0', 16);
  // Meshtastic-style chat stores use uint32 node ids; fold so DM tabs and filters stay consistent.
  return (Number.isFinite(parsed) ? parsed : 0) >>> 0;
}

/** Normalize a stored node id to the uint32 Reticulum chat key. */
export function normalizeReticulumNodeId(nodeId: number): number {
  return nodeId >>> 0;
}

const hashByNodeId = new Map<number, string>();

export function registerReticulumDestinationHash(nodeId: number, hash: string): void {
  if (!hash) return;
  hashByNodeId.set(nodeId, hash);
}

export function resolveReticulumDestinationHash(
  nodeId: number | undefined,
  fallbackHash?: string | null,
): string | null {
  if (fallbackHash) return fallbackHash;
  if (nodeId == null) return null;
  return hashByNodeId.get(nodeId) ?? null;
}

export function clearReticulumHashRegistry(): void {
  hashByNodeId.clear();
}
