/**
 * Shared argument mapping for resending a message, used by both the manual Resend
 * action in `App.tsx` and announce-triggered auto-resend. Keeping one mapping means
 * `retryOfStoreId` rekeying behaves identically on both paths.
 */

export interface ResendableMessage {
  payload: string;
  channel: number;
  to?: number | null;
  replyId?: number | null;
  reticulum_reply_to_hash?: string;
  reticulum_message_hash?: string;
  storeId?: string;
}

export interface ResendArgs {
  text: string;
  channelIndex: number;
  destination?: number;
  replyTo?: string;
  retryOfStoreId?: string;
}

export function buildResendArgs(msg: ResendableMessage): ResendArgs {
  return {
    text: msg.payload,
    channelIndex: msg.channel,
    destination: msg.to ?? undefined,
    replyTo: msg.reticulum_reply_to_hash ?? (msg.replyId != null ? String(msg.replyId) : undefined),
    retryOfStoreId: msg.reticulum_message_hash ?? msg.storeId,
  };
}
