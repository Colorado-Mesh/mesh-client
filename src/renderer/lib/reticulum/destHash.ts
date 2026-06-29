/** Map Reticulum destination hash strings to numeric node_id for shared stores. */
export function reticulumHashToNodeId(hash: string): number {
  const hex = hash.replace(/[^0-9a-f]/gi, '').slice(0, 12);
  const parsed = Number.parseInt(hex || '0', 16);
  return Number.isFinite(parsed) ? parsed : 0;
}
