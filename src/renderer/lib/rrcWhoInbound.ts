/**
 * Apply an inbound RRC `/who` NOTICE to the hub session (roster + transcript slot).
 * Extracted from useReticulumRuntime for behavioral tests.
 */

import { parseRrcWhoNotice, type RrcParsedWhoMember } from '@/renderer/lib/rrcNoticeParsers';
import { rrcWhoNoticeJoinedRoom } from '@/renderer/lib/rrcRoomName';

export type ApplyRrcWhoInboundResult =
  | { action: 'skip' }
  | { action: 'unjoined' }
  | { action: 'nicklist-only'; room: string }
  | { action: 'transcript'; room: string };

export interface ApplyRrcWhoInboundOpts {
  hubDestHash?: string;
  mergeRoomMembers: (
    room: string,
    members: RrcParsedWhoMember[],
    mode: 'replace',
    hubHash?: string,
  ) => void;
  consumeWhoTranscriptSlot: (room: string, hubHash?: string) => boolean;
}

/**
 * Merge a `/who` roster only for a joined room. `unjoined` / `nicklist-only` must not
 * reach transcript persistence; `transcript` is the first (or forced) snapshot to show.
 *
 * Materializes `joinedRoomNames` once — callers often pass `Map.keys()`, a one-shot
 * iterator that must not be consumed before the join check.
 */
export function applyRrcWhoInboundNotice(
  body: string,
  joinedRoomNames: Iterable<string>,
  opts: ApplyRrcWhoInboundOpts,
): ApplyRrcWhoInboundResult {
  const joined = [...joinedRoomNames];
  const who = parseRrcWhoNotice(body);
  if (!who) return { action: 'skip' };
  const whoRoom = rrcWhoNoticeJoinedRoom(who.room, joined);
  if (!whoRoom) return { action: 'unjoined' };
  opts.mergeRoomMembers(whoRoom, who.members, 'replace', opts.hubDestHash);
  if (!opts.consumeWhoTranscriptSlot(whoRoom, opts.hubDestHash)) {
    return { action: 'nicklist-only', room: whoRoom };
  }
  return { action: 'transcript', room: whoRoom };
}
