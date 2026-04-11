/**
 * CORE stats binary layout (MeshCore docs/stats_binary_frames.md):
 * battery_mv (2) + uptime_secs (4) + err_flags (2) + queue_len (1) => 9 bytes.
 * Legacy layout omitted `err_flags` (7 bytes total). @liamcottle/meshcore.js still parses the
 * 7-byte shape, so when firmware sends 9 bytes `.data.queueLen` is the low byte of `err_flags`.
 */
export function queueLenFromMeshCoreCoreStatsRaw(
  raw: Uint8Array | undefined,
  meshcoreJsParsedQueueLen: number,
): number {
  if (raw == null || raw.length === 0) {
    return meshcoreJsParsedQueueLen;
  }
  if (raw.length >= 9) {
    return raw[8];
  }
  if (raw.length >= 7) {
    return raw[raw.length - 1];
  }
  return meshcoreJsParsedQueueLen;
}
