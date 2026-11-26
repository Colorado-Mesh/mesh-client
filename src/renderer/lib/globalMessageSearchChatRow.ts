import type { GlobalMessageSearchHit } from './globalMessageSearchTypes';
import { reticulumHashToNodeId } from './reticulum/destHash';
import type { ChatMessage } from './types';

/** Build a chat row from a search/inbox hit so the open thread can show it. */
export function chatMessageFromSearchHit(hit: GlobalMessageSearchHit): ChatMessage {
  const dm = hit.channel == null;
  const senderFromHash =
    hit.protocol === 'reticulum' && hit.reticulumSenderHash
      ? reticulumHashToNodeId(hit.reticulumSenderHash)
      : null;
  const senderId = senderFromHash ?? hit.senderId ?? hit.dmPeer ?? 0;
  const inbound =
    hit.protocol === 'reticulum'
      ? hit.dmPeer != null && senderId === hit.dmPeer
      : hit.dmPeer != null && hit.senderId != null && hit.senderId === hit.dmPeer;
  const to = !dm
    ? undefined
    : inbound
      ? hit.toNode != null && hit.toNode !== 0
        ? hit.toNode
        : undefined
      : (hit.dmPeer ?? undefined);
  return {
    id: hit.dbId ?? undefined,
    storeId: hit.reticulumMessageHash ?? undefined,
    sender_id: senderId,
    sender_name: hit.senderName,
    payload: hit.payload,
    channel: dm ? (hit.protocol === 'meshcore' ? -1 : 0) : (hit.channel ?? 0),
    to,
    timestamp: hit.timestamp,
    ...(hit.receivedAt != null ? { receivedAt: hit.receivedAt } : {}),
    packetId: hit.packetId ?? undefined,
    reticulum_message_hash: hit.reticulumMessageHash ?? undefined,
    reticulum_sender_hash: hit.reticulumSenderHash ?? undefined,
    status: 'acked',
  };
}

export function isGlobalMessageSearchShortcut(e: KeyboardEvent, platform: string): boolean {
  const mod = platform === 'darwin' ? e.metaKey : e.ctrlKey;
  return mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f';
}
