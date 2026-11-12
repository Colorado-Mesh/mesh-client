import type { MeshcoreTraceEntrySize } from '@/shared/meshcorePathHash';

import type { MeshcoreTraceResultEntry } from './meshcore/meshcoreHookTypes';

/**
 * Room servers do not answer companion TRACE / SendTracePath (firmware).
 * Ping for Rooms must use Status (same as the Status row action), not TraceData.
 */
export function meshcoreShouldPingRoomViaStatus(hwModel: string | null | undefined): boolean {
  return hwModel === 'Room';
}

/**
 * Synthetic zero-hop ping result after a Room answers Status, so the Repeaters panel
 * can show the same success path/SNR affordances as a TraceData ping on a Repeater.
 */
export function meshcoreRoomStatusPingTraceResult(opts: {
  destPubKey: Uint8Array;
  /** Companion path.hash.mode size (1/2/3); TRACE wire has no 3-byte entry, so 3 → 2. */
  pathHashSizeBytes: 1 | 2 | 3;
  lastSnrDb: number;
}): MeshcoreTraceResultEntry {
  const entryBytes = (
    opts.pathHashSizeBytes === 3 ? 2 : opts.pathHashSizeBytes
  ) as MeshcoreTraceEntrySize;
  const pathHashes = Array.from(opts.destPubKey.subarray(0, entryBytes));
  return {
    pathLen: 1,
    pathHashes,
    hashSizeBytes: entryBytes,
    pathSnrs: [opts.lastSnrDb],
    lastSnr: opts.lastSnrDb,
    tag: 0,
    fromStatusPing: true,
  };
}
