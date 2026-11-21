import { CHAT_SEND_ERROR_DEST_KEY_KEY } from '@/renderer/lib/chatSendErrorI18n';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  findReticulumParentRecordByHash,
  persistReticulumOutboundRecord,
  resolveReticulumOutboundSenderHash,
} from '@/renderer/lib/ingest/reticulumIngest';
import { markOutboundBlocked } from '@/renderer/lib/markOutboundBlocked';
import { truncateReplyPreviewText } from '@/renderer/lib/replyPreview';
import {
  registerReticulumDestinationHash,
  resolveReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { resolveReticulumChatLxmfDestination } from '@/renderer/lib/reticulum/resolveReticulumChatLxmfDest';
import { setReticulumPredictedRoute } from '@/renderer/lib/reticulum/reticulumRouteCoverage';
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
import {
  reticulumHashForNodeId,
  useReticulumPeerStore,
} from '@/renderer/stores/reticulumPeerStore';

export type ResolveReticulumChatDestHashResult =
  { status: 'ok'; hash: string } | { status: 'missing' } | { status: 'missing_lxmf' };

/**
 * Resolve Chat DM destination to an LXMF delivery hash (never telephony/other aspects).
 */
export function resolveReticulumChatDestHashDetailed(
  destination: number | undefined,
): ResolveReticulumChatDestHashResult {
  const raw =
    reticulumHashForNodeId(destination ?? 0) ?? resolveReticulumDestinationHash(destination);
  if (!raw) return { status: 'missing' };
  const resolved = resolveReticulumChatLxmfDestination(raw);
  if (resolved.status === 'ok') {
    const nodeId = (destination ?? reticulumHashToNodeId(resolved.hash)) >>> 0;
    // Bind the active DM node id to the LXMF hash so face/probe/send stay aligned after remap.
    registerReticulumDestinationHash(nodeId, resolved.hash);
    registerReticulumDestinationHash(reticulumHashToNodeId(resolved.hash), resolved.hash);
    return { status: 'ok', hash: resolved.hash };
  }
  if (resolved.status === 'missing_lxmf') return { status: 'missing_lxmf' };
  return { status: 'missing' };
}

export function resolveReticulumChatDestHash(destination: number | undefined): string | null {
  const result = resolveReticulumChatDestHashDetailed(destination);
  return result.status === 'ok' ? result.hash : null;
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
  onMissingLxmfDelivery?: () => void;
}

/**
 * Optimistic store + SQLite outbound row, then sidecar LXMF send.
 * Returns the optimistic store id when the Reticulum path handled the attempt
 * (including soft failures); otherwise null.
 */
export function sendReticulumChatMessage(opts: SendReticulumChatMessageOpts): string | null {
  const {
    identityId,
    text,
    channelIndex,
    destination,
    replyTo,
    retryOfStoreId,
    onNoPropagationNode,
    onMissingLxmfDelivery,
  } = opts;
  const session = tryGetReticulumSession();
  const send = getReticulumSendMessage(session);
  if (!send || !session) {
    console.warn('[sendReticulumChatMessage] Reticulum runtime not mounted');
    return null;
  }
  const destResolved = resolveReticulumChatDestHashDetailed(destination);
  if (destResolved.status === 'missing_lxmf') {
    console.warn(
      '[sendReticulumChatMessage] destination is not lxmf.delivery (e.g. lxst.telephony)',
      destination,
    );
    onMissingLxmfDelivery?.();
    return null;
  }
  const destHash = destResolved.status === 'ok' ? destResolved.hash : null;
  const selfNodeId = session.selfNodeId;
  if (typeof selfNodeId !== 'number') {
    console.warn('[sendReticulumChatMessage] Reticulum self node id not ready');
    return null;
  }
  // Orphan / missing peer hash: keep a Blocked bubble so retries do not look like delivery ACK failure.
  // Return null so outbox skips assertReticulumSendAcked / auto-resend ACK waits.
  if (!destHash && destination != null && destination !== 0) {
    console.warn('[sendReticulumChatMessage] no Reticulum destination hash for', destination);
    const senderName = session.getFullNodeLabel(selfNodeId);
    const senderHash = resolveReticulumOutboundSenderHash(selfNodeId);
    const replyFields = buildReticulumReplyFields(identityId, replyTo);
    const existing =
      retryOfStoreId != null && retryOfStoreId !== ''
        ? // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
          useMessageStore.getState().messages[identityId]?.[retryOfStoreId]
        : undefined;
    let pendingId: string;
    let record: MessageRecord;
    if (existing) {
      pendingId = existing.id;
      record = {
        ...existing,
        from: selfNodeId >>> 0,
        senderName,
        to: destination >>> 0,
        payload: text,
        channelIndex,
        status: 'sending',
        error: undefined,
        ...replyFields,
      };
      upsertMessage(identityId, record);
    } else {
      pendingId = `reticulum-pending-${Date.now()}`;
      record = {
        id: pendingId,
        from: selfNodeId >>> 0,
        senderName,
        to: destination >>> 0,
        payload: text,
        channelIndex,
        timestamp: Date.now(),
        status: 'sending',
        ...replyFields,
      };
      addMessage(identityId, record);
    }
    const blockedError = markOutboundBlocked(identityId, pendingId, CHAT_SEND_ERROR_DEST_KEY_KEY);
    const blockedRecord =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
      useMessageStore.getState().messages[identityId]?.[pendingId] ?? {
        ...record,
        status: 'blocked' as const,
        error: blockedError,
      };
    if (senderHash) {
      persistReticulumOutboundRecord(
        identityId,
        blockedRecord,
        senderHash,
        senderName,
        null,
        'blocked',
      );
    }
    return null;
  }
  if (!destHash) {
    console.warn('[sendReticulumChatMessage] no Reticulum destination hash for', destination);
    return null;
  }
  const receivedVia = resolveReticulumOutboundVia(destHash);
  // Prefer LXMF fold so remapped telephony tabs still attribute the outbound to the Chat peer.
  const toNodeId = reticulumHashToNodeId(destHash) >>> 0;
  const senderName = session.getFullNodeLabel(selfNodeId);
  const senderHash = resolveReticulumOutboundSenderHash(selfNodeId);
  const existing =
    retryOfStoreId != null && retryOfStoreId !== ''
      ? // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
        useMessageStore.getState().messages[identityId]?.[retryOfStoreId]
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
  const peer = useReticulumPeerStore.getState().getPeer(destHash);
  setReticulumPredictedRoute(identityId, pendingId, {
    hops: peer?.hops ?? peer?.path_hops,
    viaHash: peer?.via_hash,
  });
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
  return pendingId;
}
