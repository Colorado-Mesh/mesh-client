/**
 * Collect outbound LXMF dest hashes from Chat messages for stale-contact detection.
 */

import { resolveReticulumDestinationHash } from '@/renderer/lib/reticulum/destHash';
import type { ChatMessage } from '@/renderer/lib/types';
import type { MessageRecord } from '@/renderer/stores/messageStore';
import { reticulumHashForNodeId } from '@/renderer/stores/reticulumPeerStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

export interface ReticulumChatOutboundDestStats {
  failedOutboundHashes: Set<string>;
  deliveredOutboundHashes: Set<string>;
}

function hashForOutboundDest(toNodeId: number): string | null {
  const raw = resolveReticulumDestinationHash(toNodeId) ?? reticulumHashForNodeId(toNodeId) ?? null;
  return raw ? canonicalizeReticulumDestinationHash(raw) : null;
}

function ownSet(ownNodeIds: ReadonlySet<number> | readonly number[]): Set<number> {
  const out = new Set<number>();
  for (const n of ownNodeIds) {
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

function accumulateOutboundDest(
  stats: ReticulumChatOutboundDestStats,
  own: ReadonlySet<number>,
  from: number,
  to: number,
  status: string | undefined,
): void {
  if (!Number.isFinite(to) || !own.has(from)) return;
  const hash = hashForOutboundDest(to);
  if (!hash) return;
  if (status === 'failed') stats.failedOutboundHashes.add(hash);
  if (status === 'acked') stats.deliveredOutboundHashes.add(hash);
}

/**
 * Scan Chat messages for failed vs delivered outbound DMs keyed by destination hash.
 * Own-node detection uses `ownNodeIds` (and treats missing sender match as skip).
 */
export function collectReticulumChatOutboundDestStats(
  messages: readonly ChatMessage[],
  ownNodeIds: ReadonlySet<number> | readonly number[],
): ReticulumChatOutboundDestStats {
  const own = ownSet(ownNodeIds);
  const stats: ReticulumChatOutboundDestStats = {
    failedOutboundHashes: new Set(),
    deliveredOutboundHashes: new Set(),
  };
  for (const msg of messages) {
    if (msg.to == null) continue;
    accumulateOutboundDest(stats, own, msg.sender_id, msg.to, msg.status);
  }
  return stats;
}

/** Same as {@link collectReticulumChatOutboundDestStats} for Zustand `MessageRecord` rows. */
export function collectReticulumOutboundDestStatsFromRecords(
  records: Iterable<Pick<MessageRecord, 'from' | 'to' | 'status'>>,
  ownNodeIds: ReadonlySet<number> | readonly number[],
): ReticulumChatOutboundDestStats {
  const own = ownSet(ownNodeIds);
  const stats: ReticulumChatOutboundDestStats = {
    failedOutboundHashes: new Set(),
    deliveredOutboundHashes: new Set(),
  };
  for (const msg of records) {
    accumulateOutboundDest(stats, own, msg.from, msg.to, msg.status);
  }
  return stats;
}
