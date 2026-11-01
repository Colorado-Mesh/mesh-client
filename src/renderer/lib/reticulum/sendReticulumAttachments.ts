import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  ingestReticulumLxmfPayloadWithSideEffects,
  persistReticulumOutboundRecord,
  resolveReticulumOutboundSenderHash,
} from '@/renderer/lib/ingest/reticulumIngest';
import { flushPendingReticulumOutboundDeliveryStatus } from '@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus';
import { reticulumHashToNodeId } from '@/renderer/lib/reticulum/destHash';
import { extractLxmfPayloadFromSendResponse } from '@/renderer/lib/reticulum/lxmfSendResponse';
import {
  bytesToBase64,
  type PreparedReticulumAttachments,
} from '@/renderer/lib/reticulum/prepareReticulumAttachments';
import { shouldDeletePriorReticulumOutboundHash } from '@/renderer/lib/reticulum/reticulumOutboundRetry';
import { resolveReticulumChatDestHashDetailed } from '@/renderer/lib/reticulum/sendReticulumChatMessage';
import {
  resolveReticulumOutboundVia,
  tryGetReticulumSession,
} from '@/renderer/lib/sessions/reticulumSession';
import type { IdentityId } from '@/renderer/lib/types';
import {
  addMessage,
  type MessageRecord,
  renameMessageId,
  updateMessageStatus,
  useMessageStore,
} from '@/renderer/stores/messageStore';
import { useReticulumAttachmentSendStore } from '@/renderer/stores/reticulumAttachmentSendStore';
import {
  LXMF_SEND_API_PATH,
  type LxmfFileAttachmentWire,
  lxmfMessageCancelApiPath,
  lxmfMessageProgressApiPath,
  parseReticulumAttachmentErrorCode,
  type ReticulumAttachmentErrorCode,
} from '@/shared/reticulum-attachment-types';
import { RETICULUM_MESSAGE_TOO_LARGE_FOR_PROPAGATION } from '@/shared/reticulum-voice-memo-types';

/** Poll interval for sidecar outbound progress while a transfer chip is visible. */
export const RETICULUM_ATTACHMENT_PROGRESS_POLL_MS = 1_000;
/** Stop tracking (chip + polling) after this long; delivery status still lands on the row. */
export const RETICULUM_ATTACHMENT_TRACK_MAX_MS = 15 * 60_000;

export type SendReticulumAttachmentsFailure =
  | ReticulumAttachmentErrorCode
  | 'runtime_unavailable'
  | 'missing_lxmf_delivery'
  | 'no_destination'
  | 'self_not_ready'
  | 'cache_failed'
  | 'no_propagation_node'
  | 'too_large_for_propagation'
  | 'send_failed';

export interface SendReticulumAttachmentsOpts {
  identityId: IdentityId;
  destination?: number;
  prepared: PreparedReticulumAttachments;
  /** Called once when the send is rejected before/at enqueue (not for later wire failures). */
  onFailure: (reason: SendReticulumAttachmentsFailure) => void;
}

function sanitizeMarkerPart(s: string): string {
  return s.replace(/[[\]:]/g, '_');
}

interface OutboundItem {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

function itemsFromPrepared(prepared: PreparedReticulumAttachments): OutboundItem[] {
  return prepared.kind === 'photo' ? [prepared.photo] : prepared.files;
}

function buildSendBody(
  destHash: string,
  prepared: PreparedReticulumAttachments,
): Record<string, unknown> {
  if (prepared.kind === 'photo') {
    return {
      destination_hash: destHash,
      text: '',
      image: {
        format: prepared.photo.format,
        data_base64: bytesToBase64(prepared.photo.bytes),
      },
    };
  }
  const attachments: LxmfFileAttachmentWire[] = prepared.files.map((f) => ({
    file_name: f.fileName,
    data_base64: bytesToBase64(f.bytes),
  }));
  return { destination_hash: destHash, text: '', attachments };
}

function messageStatusOf(identityId: IdentityId, hash: string): string | undefined {
  const bucket = useMessageStore.getState().messages[identityId] as
    Record<string, MessageRecord> | undefined;
  return bucket && Object.hasOwn(bucket, hash) ? bucket[hash].status : undefined;
}

function isTerminal(status: string | undefined): boolean {
  return status === 'acked' || status === 'failed';
}

/** Cancel an in-flight attachment transfer (sidecar router + Direct link). */
export async function cancelReticulumAttachmentTransfer(id: string): Promise<void> {
  const store = useReticulumAttachmentSendStore.getState();
  const transfer = store.transfers.find((t) => t.id === id);
  if (!transfer || transfer.cancelling) return;
  store.patch(id, { cancelling: true });
  const hash = transfer.messageHash;
  if (!hash) return; // sender observes `cancelling` as soon as the hash is known
  try {
    const res = (await window.electronAPI.reticulum.proxyPost(
      lxmfMessageCancelApiPath(hash),
      {},
    )) as { ok?: boolean; cancelled?: boolean } | null;
    if (res?.ok !== false) {
      if (res?.cancelled) {
        updateMessageStatus(transfer.identityId, hash, 'failed', 'cancelled');
      }
      useReticulumAttachmentSendStore.getState().end(id);
    } else {
      useReticulumAttachmentSendStore.getState().patch(id, { cancelling: false });
    }
  } catch (e) {
    console.warn('[sendReticulumAttachments] cancel failed:', errLikeToLogString(e));
    useReticulumAttachmentSendStore.getState().patch(id, { cancelling: false });
  }
}

function trackTransfer(id: string, identityId: IdentityId, hash: string): void {
  const startedAt = Date.now();
  let inFlight = false;
  const timer = setInterval(() => {
    const transfer = useReticulumAttachmentSendStore.getState().transfers.find((t) => t.id === id);
    const status = messageStatusOf(identityId, hash);
    if (
      !transfer ||
      isTerminal(status) ||
      Date.now() - startedAt > RETICULUM_ATTACHMENT_TRACK_MAX_MS
    ) {
      clearInterval(timer);
      useReticulumAttachmentSendStore.getState().end(id);
      return;
    }
    if (inFlight) return;
    inFlight = true;
    void window.electronAPI.reticulum
      .proxyGet(lxmfMessageProgressApiPath(hash))
      .then((res) => {
        const p = (res as { progress?: number | null } | null)?.progress;
        if (typeof p === 'number' && Number.isFinite(p)) {
          useReticulumAttachmentSendStore
            .getState()
            .patch(id, { progress: Math.min(1, Math.max(0, p)) });
        }
      })
      .catch((e: unknown) => {
        console.debug('[sendReticulumAttachments] progress poll failed:', errLikeToLogString(e));
      })
      .finally(() => {
        inFlight = false;
      });
  }, RETICULUM_ATTACHMENT_PROGRESS_POLL_MS);
}

/**
 * Send prepared files / a photo as native LXMF `FIELD_FILE_ATTACHMENTS` / `FIELD_IMAGE` to an
 * LXMF DM peer (not rncp). Local bytes are cached under the attachments jail first so the sender's
 * own bubble reuses the inbound render path (`ReticulumAttachmentLine`). Resolves after the sidecar
 * accepted the send (or rejected it); delivery status continues over `lxmf_outbound_status`.
 */
export async function sendReticulumAttachments(
  opts: SendReticulumAttachmentsOpts,
): Promise<boolean> {
  const { identityId, destination, prepared, onFailure } = opts;
  const fail = (reason: SendReticulumAttachmentsFailure): false => {
    onFailure(reason);
    return false;
  };

  const session = tryGetReticulumSession();
  if (!session) return fail('runtime_unavailable');
  const destResolved = resolveReticulumChatDestHashDetailed(destination);
  if (destResolved.status === 'missing_lxmf') return fail('missing_lxmf_delivery');
  const destHash = destResolved.status === 'ok' ? destResolved.hash : null;
  if (!destHash) return fail('no_destination');
  const selfNodeId = session.selfNodeId;
  if (typeof selfNodeId !== 'number') return fail('self_not_ready');

  const items = itemsFromPrepared(prepared);
  if (items.length === 0) return fail('attachment_empty');
  const first = items[0];
  const sizeBytes = items.reduce((n, i) => n + i.bytes.length, 0);

  // Cache the first item locally (inbound-parity bubble + Save / Show in folder).
  let attachmentPath: string | null = null;
  try {
    const res = await window.electronAPI.chat.saveReticulumAttachment({
      fileName: first.fileName,
      mimeType: first.mimeType,
      dataBase64: bytesToBase64(first.bytes),
      promptSave: false,
    });
    attachmentPath = res.success && res.path ? res.path : null;
  } catch (e) {
    console.warn('[sendReticulumAttachments] local cache failed:', errLikeToLogString(e));
  }
  if (!attachmentPath) return fail('cache_failed');

  const marker = `[file:${sanitizeMarkerPart(first.fileName)}:${first.mimeType}]`;
  const pendingId = `reticulum-pending-file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const receivedVia = resolveReticulumOutboundVia(destHash);
  const senderName = session.getFullNodeLabel(selfNodeId);
  const senderHash = resolveReticulumOutboundSenderHash(selfNodeId);
  const toNodeId = reticulumHashToNodeId(destHash) >>> 0;
  const record: MessageRecord = {
    id: pendingId,
    from: selfNodeId >>> 0,
    senderName,
    to: toNodeId,
    payload: marker,
    channelIndex: 0,
    timestamp: Date.now(),
    status: 'sending',
    receivedVia,
    reticulumAttachmentKind: 'image',
    reticulumAttachmentPath: attachmentPath,
  };
  addMessage(identityId, record);
  if (senderHash) {
    persistReticulumOutboundRecord(identityId, record, senderHash, senderName, destHash, 'sending');
  }

  const transferId = pendingId;
  useReticulumAttachmentSendStore.getState().begin({
    id: transferId,
    identityId,
    destination: toNodeId,
    fileName: items.length > 1 ? `${first.fileName} +${items.length - 1}` : first.fileName,
    sizeBytes,
    messageHash: null,
    progress: null,
    cancelling: false,
  });

  const failRow = (reason: SendReticulumAttachmentsFailure, rowId: string, detail?: string) => {
    updateMessageStatus(identityId, rowId, 'failed', detail ?? reason);
    useReticulumAttachmentSendStore.getState().end(transferId);
    onFailure(reason);
    return false as const;
  };

  /** Row id for failure reporting: the optimistic id until the sidecar returns the hash. */
  let rowId = pendingId;
  try {
    const res = await window.electronAPI.reticulum.proxyPost(
      LXMF_SEND_API_PATH,
      buildSendBody(destHash, prepared),
    );
    const resObj =
      res && typeof res === 'object' ? (res as { ok?: boolean; error?: string }) : null;
    if (resObj?.ok === false) {
      const err = resObj.error ?? 'lxmf_send_failed';
      if (err === 'no_propagation_node') return failRow('no_propagation_node', pendingId, err);
      if (err === RETICULUM_MESSAGE_TOO_LARGE_FOR_PROPAGATION) {
        return failRow('too_large_for_propagation', pendingId, err);
      }
      return failRow(parseReticulumAttachmentErrorCode(err) ?? 'send_failed', pendingId, err);
    }

    const lxmfPayload = extractLxmfPayloadFromSendResponse(res);
    const hash = lxmfPayload?.message_hash;
    if (!lxmfPayload || !hash) return failRow('send_failed', pendingId, 'missing_message_hash');

    renameMessageId(identityId, pendingId, hash);
    rowId = hash;
    useReticulumAttachmentSendStore.getState().patch(transferId, { messageHash: hash });
    const replacesMessageHash = shouldDeletePriorReticulumOutboundHash(pendingId, hash)
      ? pendingId
      : undefined;
    ingestReticulumLxmfPayloadWithSideEffects(identityId, lxmfPayload, {
      selfLxmfHash: senderHash ?? undefined,
      replacesMessageHash,
      attachmentPath,
      attachmentKind: 'image',
    });
    const bucket = useMessageStore.getState().messages[identityId];
    if (Object.hasOwn(bucket, hash)) {
      const finalRow = bucket[hash];
      if (senderHash) {
        persistReticulumOutboundRecord(
          identityId,
          {
            ...finalRow,
            reticulumAttachmentPath: attachmentPath,
            reticulumAttachmentKind: 'image',
          },
          senderHash,
          senderName,
          destHash,
          finalRow.status === 'acked' ? 'acked' : 'sending',
          replacesMessageHash,
        );
      }
      flushPendingReticulumOutboundDeliveryStatus(identityId, hash);
    }
    const afterFlush = messageStatusOf(identityId, hash);
    if (afterFlush !== 'acked' && afterFlush !== 'failed') {
      updateMessageStatus(identityId, hash, 'sending');
    }

    // Cancel clicked while the enqueue POST was still in flight.
    const transfer = useReticulumAttachmentSendStore
      .getState()
      .transfers.find((t) => t.id === transferId);
    if (transfer?.cancelling) {
      useReticulumAttachmentSendStore.getState().patch(transferId, { cancelling: false });
      void cancelReticulumAttachmentTransfer(transferId);
    }
    if (isTerminal(afterFlush)) {
      useReticulumAttachmentSendStore.getState().end(transferId);
    } else {
      trackTransfer(transferId, identityId, hash);
    }
    return true;
  } catch (e) {
    const errMsg = errLikeToLogString(e);
    console.warn('[sendReticulumAttachments] send failed:', errMsg);
    let reason: SendReticulumAttachmentsFailure;
    if (errMsg.includes('no_propagation_node')) reason = 'no_propagation_node';
    else if (errMsg.includes(RETICULUM_MESSAGE_TOO_LARGE_FOR_PROPAGATION)) {
      reason = 'too_large_for_propagation';
    } else {
      reason = parseReticulumAttachmentErrorCode(errMsg) ?? 'send_failed';
    }
    return failRow(reason, rowId, errMsg);
  }
}
