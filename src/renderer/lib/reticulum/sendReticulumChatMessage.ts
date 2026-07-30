import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  findReticulumParentRecordByHash,
  persistReticulumOutboundRecord,
  resolveReticulumOutboundSenderHash,
} from '@/renderer/lib/ingest/reticulumIngest';
import { truncateReplyPreviewText } from '@/renderer/lib/replyPreview';
import {
  resolveReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import {
  getReticulumSendMessage,
  resolveReticulumOutboundVia,
  tryGetReticulumSession,
} from '@/renderer/lib/sessions/reticulumSession';
import type { IdentityId } from '@/renderer/lib/types';
import {
  addMessage,
  type MessageRecord,
  upsertMessage,
  useMessageStore,
} from '@/renderer/stores/messageStore';
import { reticulumHashForNodeId } from '@/renderer/stores/reticulumPeerStore';

export function resolveReticulumChatDestHash(destination: number | undefined): string | null {
  if (typeof destination === 'string') return destination;
  return reticulumHashForNodeId(destination ?? 0) ?? resolveReticulumDestinationHash(destination);
}

export function buildReticulumReplyFields(
  identityId: IdentityId,
  replyTo: string | undefined,
): Partial<MessageRecord> {
  if (!replyTo) return {};
  const parent = findReticulumParentRecordByHash(identityId, replyTo);
  const replyPreviewText = parent ? truncateReplyPreviewText(parent.payload) : undefined;
  const replyPreviewSender = parent?.senderName?.trim() || undefined;
  return {
    reticulumReplyToHash: replyTo,
    ...(replyPreviewText ? { replyPreviewText } : {}),
    ...(replyPreviewSender ? { replyPreviewSender } : {}),
  };
}

export interface SendReticulumChatMessageOpts {
  identityId: IdentityId;
  text: string;
  channelIndex: number;
  destination?: number;
  replyTo?: string;
  retryOfStoreId?: string;
  onNoPropagationNode: () => void;
}

/**
 * Optimistic store + SQLite outbound row, then sidecar LXMF send.
 * Returns true when the Reticulum path handled the attempt (including soft failures).
 */
export function sendReticulumChatMessage(opts: SendReticulumChatMessageOpts): boolean {
  const {
    identityId,
    text,
    channelIndex,
    destination,
    replyTo,
    retryOfStoreId,
    onNoPropagationNode,
  } = opts;
  const session = tryGetReticulumSession();
  const send = getReticulumSendMessage(session);
  if (!send || !session) {
    console.warn('[sendReticulumChatMessage] Reticulum runtime not mounted');
    return true;
  }
  const destHash = resolveReticulumChatDestHash(destination);
  if (!destHash) {
    console.warn('[sendReticulumChatMessage] no Reticulum destination hash for', destination);
    return true;
  }
  const selfNodeId = session.selfNodeId;
  if (typeof selfNodeId !== 'number') {
    console.warn('[sendReticulumChatMessage] Reticulum self node id not ready');
    return true;
  }
  const receivedVia = resolveReticulumOutboundVia(destHash);
  const toNodeId = (destination ?? reticulumHashToNodeId(destHash)) >>> 0;
  const senderName = session.getFullNodeLabel(selfNodeId);
  const senderHash = resolveReticulumOutboundSenderHash(selfNodeId);
  const existing =
    retryOfStoreId != null && retryOfStoreId !== ''
      ? useMessageStore.getState().messages[identityId]?.[retryOfStoreId]
      : undefined;
  const replyFields = buildReticulumReplyFields(identityId, replyTo);

  let pendingId: string;
  let record: MessageRecord;
  if (existing) {
    pendingId = existing.id;
    record = {
      ...existing,
      from: selfNodeId >>> 0,
      senderName,
      to: toNodeId,
      payload: text,
      channelIndex,
      status: 'sending',
      receivedVia,
      error: undefined,
      reticulumDeliveryMethod: undefined,
      reticulumMessageHash: undefined,
      ...replyFields,
    };
    upsertMessage(identityId, record);
  } else {
    pendingId = `reticulum-pending-${Date.now()}`;
    record = {
      id: pendingId,
      from: selfNodeId >>> 0,
      senderName,
      to: toNodeId,
      payload: text,
      channelIndex,
      timestamp: Date.now(),
      status: 'sending',
      receivedVia,
      ...replyFields,
    };
    addMessage(identityId, record);
  }
  if (senderHash) {
    persistReticulumOutboundRecord(identityId, record, senderHash, senderName, destHash, 'sending');
  }
  const replyPreviewText = replyFields.replyPreviewText;
  void send(text, destHash, replyTo ?? undefined, pendingId, replyPreviewText).catch(
    (e: unknown) => {
      const err = errLikeToLogString(e);
      if (err.includes('no_propagation_node')) {
        onNoPropagationNode();
      }
      console.warn('[sendReticulumChatMessage] reticulum send failed ' + err);
    },
  );
  return true;
}
