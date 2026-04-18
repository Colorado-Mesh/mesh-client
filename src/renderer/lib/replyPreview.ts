import type { ChatMessage } from './types';

/** MM-PLAN Feature 2: truncated original message text (max 50 chars). */
export const REPLY_PREVIEW_MAX_LEN = 50;

export function truncateReplyPreviewText(payload: string): string {
  return payload.length > REPLY_PREVIEW_MAX_LEN
    ? payload.slice(0, REPLY_PREVIEW_MAX_LEN) + '…'
    : payload;
}

/** Same key strategy as ChatPanel `messageByReplyKey` / MeshCore `findMessageByKey`. */
export function findParentMessageForReply(
  messages: readonly ChatMessage[],
  replyId: number,
): ChatMessage | undefined {
  return messages.find((m) => m.packetId === replyId || m.timestamp === replyId);
}

/**
 * Fills reply preview fields when the parent message is present in `priorMessages`
 * (Meshtastic RF/MQTT ingest).
 */
export function enrichMeshtasticReplyPreviews(
  msg: ChatMessage,
  priorMessages: readonly ChatMessage[],
  resolveSenderLabel: (senderId: number) => string,
): ChatMessage {
  if (msg.replyId == null) return msg;
  const parent = findParentMessageForReply(priorMessages, msg.replyId);
  if (!parent) return msg;
  const label =
    parent.sender_name != null && parent.sender_name.trim() !== ''
      ? parent.sender_name
      : resolveSenderLabel(parent.sender_id);
  return {
    ...msg,
    replyPreviewText: truncateReplyPreviewText(parent.payload),
    replyPreviewSender: label,
  };
}
