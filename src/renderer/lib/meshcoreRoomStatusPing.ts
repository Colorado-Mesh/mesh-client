import type { MeshcoreTraceEntrySize } from '@/shared/meshcorePathHash';

import type { MeshcoreTraceResultEntry } from './meshcore/meshcoreHookTypes';

/**
 * Room Ping gate — see KNOWN-GOOD block in `useMeshcoreRuntime` `traceRoute`.
 *
 * Room servers do not answer companion TRACE / SendTracePath (firmware). Ping for Rooms
 * must use Status (same as the Status row action), not TraceData. Do not rewrite Room Ping
 * to share repeater TRACE prep (`resolveMeshcorePingHopsAway`, contact refresh for wire
 * seeds, direct-first / 0xFF planning): Status is pubkey-framed and only needs admin hops
 * plus NOT_FOUND contact restore. Enforced by `useMeshcoreRuntime.room-ping.contract.test.ts`.
 */
export function meshcoreShouldPingRoomViaStatus(hwModel: string | null | undefined): boolean {
  return hwModel === 'Room';
}

/**
 * Synthetic zero-hop ping result after a Room answers Status, so the Repeaters panel
 * can show the same success path/SNR affordances as a TraceData ping on a Repeater.
 * `fromStatusPing` must stay set so hops_away is not stamped from this synthetic TraceData.
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
