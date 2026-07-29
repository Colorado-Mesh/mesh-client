import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { truncateReplyPreviewText } from '@/renderer/lib/replyPreview';
import { messageTransportFromWire } from '@/renderer/lib/reticulum/classifyReticulumVia';
import {
  registerReticulumDestinationHash,
  resolveReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { computeReticulumMessageHash } from '@/renderer/lib/reticulum/messageHash';
import {
  isDefaultReticulumProfileIcon,
  parseReticulumIconAppearanceFromPayload,
  type ReticulumIconAppearanceWire,
} from '@/renderer/lib/reticulum/reticulumIconAppearance';
import {
  mergeReticulumIngestRecord,
  type ReticulumIngestMergeContext,
} from '@/renderer/lib/reticulum/reticulumIngestMerge';
import {
  normalizeReticulumMessageHash,
  reticulumMessageHashesEqual,
} from '@/renderer/lib/reticulum/reticulumMessageHash';
import { reticulumDbRowToMessageRecord } from '@/renderer/lib/storeRecordAdapters';
import type { IdentityId } from '@/renderer/lib/types';
import { useBlockStore } from '@/renderer/stores/blockStore';
import type { MessageRecord, MessageStatus } from '@/renderer/stores/messageStore';
import { addMessage, upsertMessage, useMessageStore } from '@/renderer/stores/messageStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import {
  isReticulumHashPrefixAlias,
  reticulumRealDisplayName,
  sanitizeReticulumDisplayName,
} from '@/shared/reticulumDisplayName';

export interface ReticulumLxmfPayload {
  sender_hash?: string;
  sender_name?: string;
  text?: string;
  timestamp?: number;
  to_hash?: string;
  reply_to_hash?: string;
  reply_preview_text?: string;
  reply_preview_sender?: string;
  message_hash?: string;
  direction?: string;
  reaction_target?: string;
  received_via?: string;
  sent_via?: string;
  delivery_status?: string;
  delivery_method?: string;
  attachment?: { file_name?: string; mime_type?: string; data_base64?: string };
  icon_appearance?: ReticulumIconAppearanceWire | null;
}

/** Re-export for call sites that historically imported the predicate from ingest. */
export { isReticulumHashPrefixAlias };

/** Display name suitable for SQLite upsert; omits hash-prefix placeholders. */
export function reticulumContactDisplayNameFromPayload(
  p: ReticulumLxmfPayload,
): string | undefined {
  if (!p.sender_hash) return undefined;
  return reticulumRealDisplayName(p.sender_hash, p.sender_name) ?? undefined;
}

function parseReticulumDeliveryMethod(
  value: string | undefined,
): MessageRecord['reticulumDeliveryMethod'] {
  if (value === 'direct' || value === 'propagated' || value === 'opportunistic') return value;
  return undefined;
}

function mapDeliveryStatusToMessageStatus(
  deliveryStatus: string | null | undefined,
  direction?: string,
): MessageStatus {
  if (deliveryStatus === 'failed') return 'failed';
  if (deliveryStatus === 'delivered') return 'acked';
  if (deliveryStatus === 'queued' || deliveryStatus === 'sending' || deliveryStatus === 'pending') {
    return 'sending';
  }
  if (direction === 'inbound') return 'acked';
  if (direction === 'outbound') return 'sending';
  return 'acked';
}

function resolvePersistedDeliveryStatus(p: ReticulumLxmfPayload): string | null {
  if (p.delivery_status) return p.delivery_status;
  if (p.direction === 'inbound') return 'delivered';
  return null;
}

function resolvePayloadTransport(p: ReticulumLxmfPayload) {
  return messageTransportFromWire(p.received_via, p.sent_via, p.direction);
}

/** Look up a prior LXMF row by message hash within an identity's store. */
export function findReticulumParentRecordByHash(
  identityId: IdentityId,
  replyToHash: string,
): MessageRecord | undefined {
  const target = normalizeReticulumMessageHash(replyToHash);
  if (!target) return undefined;
  const byId = useMessageStore.getState().messages[identityId];
  if (!byId) return undefined;
  const direct = byId[replyToHash] ?? byId[target];
  if (direct) return direct;
  for (const row of Object.values(byId)) {
    if (
      reticulumMessageHashesEqual(row.reticulumMessageHash, target) ||
      reticulumMessageHashesEqual(row.id, target)
    ) {
      return row;
    }
  }
  return undefined;
}

function resolveReplyPreviewFromPayload(
  identityId: IdentityId | null,
  p: ReticulumLxmfPayload,
  replyToHash: string | undefined,
): Pick<MessageRecord, 'replyPreviewText' | 'replyPreviewSender'> {
  if (!replyToHash) return {};
  const fromWireText = p.reply_preview_text?.trim();
  const fromWireSender = p.reply_preview_sender?.trim();
  const parent =
    identityId != null ? findReticulumParentRecordByHash(identityId, replyToHash) : undefined;
  const replyPreviewText =
    (parent ? truncateReplyPreviewText(parent.payload) : undefined) ??
    (fromWireText ? truncateReplyPreviewText(fromWireText) : undefined);
  const replyPreviewSender =
    (parent?.senderName?.trim() || undefined) ?? (fromWireSender || undefined);
  return {
    ...(replyPreviewText ? { replyPreviewText } : {}),
    ...(replyPreviewSender ? { replyPreviewSender } : {}),
  };
}

function payloadToMessageRecord(
  p: ReticulumLxmfPayload,
  identityId: IdentityId | null = null,
): MessageRecord | null {
  if (!p.text || !p.sender_hash) return null;

  const senderNodeId = reticulumHashToNodeId(p.sender_hash);
  registerReticulumDestinationHash(senderNodeId, p.sender_hash);
  const timestamp = p.timestamp ?? Date.now();
  const messageHash =
    p.message_hash ?? computeReticulumMessageHash(p.sender_hash, timestamp, p.text);

  const isReaction = Boolean(p.reaction_target);
  const receivedVia = resolvePayloadTransport(p);
  const status = mapDeliveryStatusToMessageStatus(p.delivery_status, p.direction);

  const deliveryMethod = parseReticulumDeliveryMethod(p.delivery_method);
  const replyToHash = isReaction ? p.reaction_target : p.reply_to_hash;
  const preview = isReaction ? {} : resolveReplyPreviewFromPayload(identityId, p, replyToHash);

  return {
    id: messageHash,
    from: senderNodeId,
    senderName: p.sender_name ?? p.sender_hash.slice(0, 12),
    to: p.to_hash ? reticulumHashToNodeId(p.to_hash) : 0,
    payload: p.text,
    channelIndex: 0,
    timestamp,
    status,
    ...(receivedVia ? { receivedVia } : {}),
    reticulumMessageHash: messageHash,
    reticulumSenderHash: p.sender_hash,
    ...(isReaction
      ? { tapback: true, reticulumReplyToHash: p.reaction_target }
      : replyToHash
        ? { reticulumReplyToHash: replyToHash, ...preview }
        : {}),
    ...(deliveryMethod ? { reticulumDeliveryMethod: deliveryMethod } : {}),
  };
}

export function ingestReticulumLxmfPayload(
  identityId: IdentityId,
  p: ReticulumLxmfPayload,
  ctx: ReticulumIngestMergeContext = {},
): boolean {
  if (p.sender_hash && useBlockStore.getState().isBlocked(p.sender_hash)) {
    return false;
  }
  const record = payloadToMessageRecord(p, identityId);
  if (!record) return false;
  const existing = useMessageStore.getState().messages[identityId]?.[record.id];
  const merged = mergeReticulumIngestRecord(existing, record, p, ctx);
  upsertMessage(identityId, merged);
  return true;
}

export async function persistReticulumMessageToDb(
  identityId: IdentityId,
  p: ReticulumLxmfPayload,
  attachmentPath?: string | null,
): Promise<void> {
  if (!p.text || !p.sender_hash) return;
  const timestamp = p.timestamp ?? Date.now();
  try {
    await window.electronAPI.db.saveReticulumMessage({
      identity_id: identityId,
      sender_id: p.sender_hash,
      sender_name: p.sender_name ?? p.sender_hash.slice(0, 12),
      payload: p.text,
      timestamp,
      to_hash: p.to_hash ?? null,
      reply_to_hash: p.reply_to_hash ?? p.reaction_target ?? null,
      message_hash: p.message_hash ?? computeReticulumMessageHash(p.sender_hash, timestamp, p.text),
      received_via: resolvePayloadTransport(p) ?? null,
      delivery_status: resolvePersistedDeliveryStatus(p),
      attachment_path: attachmentPath ?? null,
    });
  } catch (e) {
    console.warn('[reticulumIngest] save message ' + errLikeToLogString(e));
  }
}

/**
 * Persist a messaged peer as a contact destination.
 * Inbound → sender; outbound → recipient (`to_hash`), never the local sender.
 */
export async function persistReticulumContactFromPayload(p: ReticulumLxmfPayload): Promise<void> {
  const isOutbound = p.direction === 'outbound';
  const contactHash = isOutbound ? p.to_hash : p.sender_hash;
  if (!contactHash) return;

  useReticulumPeerStore.getState().restoreDismissedContact(contactHash);

  let displayName: string | undefined;
  if (isOutbound) {
    const peer = useReticulumPeerStore.getState().getPeer(contactHash);
    const candidate = peer?.custom_display_name?.trim() || peer?.display_name?.trim() || undefined;
    if (candidate && !isReticulumHashPrefixAlias(contactHash, candidate)) {
      displayName = sanitizeReticulumDisplayName(candidate) ?? undefined;
    }
  } else {
    displayName = reticulumContactDisplayNameFromPayload(p);
  }

  try {
    await window.electronAPI.db.upsertReticulumDestination({
      destination_hash: contactHash,
      ...(displayName ? { display_name: displayName } : {}),
      last_heard: Math.floor((p.timestamp ?? Date.now()) / 1000),
    });
  } catch (e) {
    console.warn('[reticulumIngest] upsert contact ' + errLikeToLogString(e));
  }
}

/** Persist peer avatar from LXMF FIELD_ICON_APPEARANCE (MeshChat wire compat). */
export async function persistReticulumIconFromPayload(p: ReticulumLxmfPayload): Promise<void> {
  if (!p.sender_hash || p.direction === 'outbound') return;
  const appearance = parseReticulumIconAppearanceFromPayload(p);
  if (!appearance || isDefaultReticulumProfileIcon(appearance.icon_name, appearance.icon_color)) {
    return;
  }
  try {
    await window.electronAPI.db.upsertReticulumDestination({
      destination_hash: p.sender_hash,
      icon_name: appearance.icon_name,
      icon_color: appearance.icon_color,
    });
    useReticulumPeerStore.getState().patchPeerAppearance(p.sender_hash, appearance);
  } catch (e) {
    console.warn('[reticulumIngest] upsert icon ' + errLikeToLogString(e));
  }
}

export function ingestReticulumLxmfPayloadWithSideEffects(
  identityId: IdentityId,
  p: ReticulumLxmfPayload,
  ctx: ReticulumIngestMergeContext = {},
): boolean {
  void persistReticulumIconFromPayload(p);
  const ingested = ingestReticulumLxmfPayload(identityId, p, ctx);
  if (!ingested) return false;
  void persistReticulumMessageToDb(identityId, p, ctx.attachmentPath);
  void persistReticulumContactFromPayload(p);
  return true;
}

export function ingestReticulumDbRows(
  identityId: IdentityId,
  rows: {
    sender_id: string;
    sender_name?: string | null;
    payload: string;
    timestamp: number;
    to_hash?: string | null;
    reply_to_hash?: string | null;
    message_hash?: string | null;
    received_via?: string | null;
  }[],
): void {
  for (const row of rows) {
    addMessage(identityId, reticulumDbRowToMessageRecord(row));
  }
}

function mapMessageStatusToDeliveryStatus(status: MessageStatus): string {
  if (status === 'failed') return 'failed';
  if (status === 'sending') return 'sending';
  return 'delivered';
}

/** Persist optimistic or final outbound LXMF row (mirrors MeshCore chat DB persist). */
export function persistReticulumOutboundRecord(
  identityId: IdentityId,
  record: MessageRecord,
  senderHash: string,
  senderName: string,
  toHash: string | null,
  status: MessageStatus,
): void {
  const deliveryStatus = mapMessageStatusToDeliveryStatus(status);
  void window.electronAPI.db
    .saveReticulumMessage({
      identity_id: identityId,
      sender_id: senderHash,
      sender_name: senderName,
      payload: record.payload,
      timestamp: record.timestamp,
      to_hash: toHash,
      reply_to_hash: record.reticulumReplyToHash ?? null,
      message_hash: record.reticulumMessageHash ?? record.id,
      received_via: record.receivedVia ?? null,
      delivery_status: deliveryStatus,
      ...(record.reticulumDeliveryMethod
        ? { delivery_method: record.reticulumDeliveryMethod }
        : {}),
    })
    .catch((e: unknown) => {
      console.warn('[reticulumIngest] save outbound ' + errLikeToLogString(e));
    });
}

export function resolveReticulumOutboundSenderHash(selfNodeId: number): string | null {
  return resolveReticulumDestinationHash(selfNodeId);
}
