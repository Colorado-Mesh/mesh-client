import {
  applyRncpReceiveDestShareFromLxmf,
  type ApplyRncpReceiveDestShareResult,
} from '@/renderer/lib/applyRncpReceiveDestShare';
import { resolveReticulumDestinationHash } from '@/renderer/lib/reticulum/destHash';
import type { IdentityId } from '@/renderer/lib/types';
import { type MessageRecord, useMessageStore } from '@/renderer/stores/messageStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';
import { parseRncpReceiveDestShare } from '@/shared/rncpRequestEnable';

/** Inbound DM rows already scoped to the open peer (from ChatPanel). */
export interface RncpDmShareCandidate {
  payload: string;
  senderHash?: string | null;
  senderName?: string | null;
  timestamp: number;
}

function senderHashForMessage(msg: MessageRecord): string | null {
  if (msg.reticulumSenderHash) {
    return canonicalizeReticulumDestinationHash(msg.reticulumSenderHash);
  }
  const fromHash = resolveReticulumDestinationHash(msg.from);
  return fromHash ? canonicalizeReticulumDestinationHash(fromHash) : null;
}

function scanBucketForShare(
  byId: Record<string, MessageRecord>,
  peer: string,
): { text: string; senderName: string | null; receiveHash: string; ts: number } | null {
  let best: { text: string; senderName: string | null; receiveHash: string; ts: number } | null =
    null;
  for (const msg of Object.values(byId)) {
    const sender = senderHashForMessage(msg);
    if (!sender || sender !== peer) continue;
    const receiveHash = parseRncpReceiveDestShare(msg.payload);
    if (!receiveHash) continue;
    if (!best || msg.timestamp > best.ts) {
      best = {
        text: msg.payload,
        senderName: msg.senderName ?? null,
        receiveHash,
        ts: msg.timestamp,
      };
    }
  }
  return best;
}

/**
 * Prefer ChatPanel DM candidates (already filtered to this peer). Sender hash is optional
 * because the DM filter already excluded our own outbound rows.
 */
export function findLatestRncpReceiveDestShareInDmCandidates(
  candidates: readonly RncpDmShareCandidate[],
): { text: string; senderName: string | null; receiveHash: string } | null {
  let best: { text: string; senderName: string | null; receiveHash: string; ts: number } | null =
    null;
  for (const row of candidates) {
    const receiveHash = parseRncpReceiveDestShare(row.payload);
    if (!receiveHash) continue;
    if (!best || row.timestamp > best.ts) {
      best = {
        text: row.payload,
        senderName: row.senderName ?? null,
        receiveHash,
        ts: row.timestamp,
      };
    }
  }
  return best
    ? { text: best.text, senderName: best.senderName, receiveHash: best.receiveHash }
    : null;
}

/**
 * Find the newest inbound LXMF body from `peerLxmfHash` that shares an rncp.receive
 * dest. Searches every identity message bucket so offline/live identity splits still match.
 */
export function findLatestRncpReceiveDestShareInChat(
  identityId: IdentityId | null | undefined,
  peerLxmfHash: string,
): { text: string; senderName: string | null; receiveHash: string } | null {
  const peer = canonicalizeReticulumDestinationHash(peerLxmfHash);
  if (!peer) return null;
  const all = useMessageStore.getState().messages;

  let best: { text: string; senderName: string | null; receiveHash: string; ts: number } | null =
    null;
  const buckets: (Record<string, MessageRecord> | undefined)[] = identityId
    ? [all[identityId], ...Object.values(all)]
    : Object.values(all);
  for (const bucket of buckets) {
    if (!bucket) continue;
    const found = scanBucketForShare(bucket, peer);
    if (found && (!best || found.ts > best.ts)) best = found;
  }

  return best
    ? { text: best.text, senderName: best.senderName, receiveHash: best.receiveHash }
    : null;
}

/** Persist a chat-history receive-dest share for Chat DM / Transfer autofill. */
export async function applyRncpReceiveDestShareFromChatHistory(
  identityId: IdentityId | null | undefined,
  peerLxmfHash: string,
  dmCandidates?: readonly RncpDmShareCandidate[],
): Promise<ApplyRncpReceiveDestShareResult | { ok: false; reason: 'no_share_in_chat' }> {
  const fromDm =
    dmCandidates && dmCandidates.length > 0
      ? findLatestRncpReceiveDestShareInDmCandidates(dmCandidates)
      : null;
  const found = fromDm ?? findLatestRncpReceiveDestShareInChat(identityId, peerLxmfHash);
  if (!found) return { ok: false, reason: 'no_share_in_chat' };
  return applyRncpReceiveDestShareFromLxmf({
    senderHash: peerLxmfHash,
    senderName: found.senderName,
    text: found.text,
  });
}
