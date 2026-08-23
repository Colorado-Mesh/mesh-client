/**
 * CORE stats binary layout (MeshCore docs/stats_binary_frames.md):
 * battery_mv (2) + uptime_secs (4) + err_flags (2) + queue_len (1) => 9 bytes.
 * Legacy layout omitted `err_flags` (7 bytes total). @liamcottle/meshcore.js still parses the
 * 7-byte shape, so when firmware sends 9 bytes `.data.queueLen` is the low byte of `err_flags`.
 *
 * Full on-wire RESP_CODE_STATS frame is 11 bytes (response_code + stats_type + 9-byte payload).
 * Some HTTP/TCP companions pad a legacy 7-byte payload to 9 bytes; byte 8 may be `0xff` or the
 * next-frame `RESP_CODE_STATS` (`0x18`) rather than `queue_len`.
 */
/** RESP_CODE_STATS — seen as TCP padding / framing leak at payload byte 8. */
export const MESHCORE_STATS_RESP_CODE = 0x18;

export function queueLenFromMeshCoreCoreStatsRaw(
  raw: Uint8Array | undefined,
  meshcoreJsParsedQueueLen: number,
): number {
  if (raw == null || raw.length === 0) {
    return meshcoreJsParsedQueueLen;
  }
  if (raw.length >= 9) {
    // HTTP/TCP companions may pad 7-byte CORE stats; treat known byte-8 sentinels as padding.
    const byte8 = raw[8];
    if (
      (byte8 === 0xff || byte8 === MESHCORE_STATS_RESP_CODE) &&
      raw[7] === 0 &&
      raw[6] === meshcoreJsParsedQueueLen
    ) {
      return raw[6];
    }
    return raw[8];
  }
  if (raw.length >= 7) {
    return raw[raw.length - 1];
  }
  return meshcoreJsParsedQueueLen;
}
