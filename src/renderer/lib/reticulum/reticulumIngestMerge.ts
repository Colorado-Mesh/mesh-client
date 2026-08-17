import type { MessageRecord } from '@/renderer/stores/messageStore';

import { normalizeReticulumNodeId, reticulumHashToNodeId } from './destHash';

export interface ReticulumIngestMergeContext {
  selfLxmfHash?: string | null;
  attachmentPath?: string | null;
  /** When the attachment is an audio file, stamp kind/mode on the record. */
  attachmentKind?: 'image' | 'audio';
  /** LXMF FIELD_AUDIO mode from the wire (16 = AM_OPUS_OGG). */
  audioMode?: number | null;
  /** Exact SQLite message_hash to replace when persisting this ingest (pending or prior hash). */
  replacesMessageHash?: string | null;
}

interface LxmfDirectionPayload {
  direction?: string;
}

function isSelfReticulumNode(nodeId: number, selfNodeId: number | null): boolean {
  if (selfNodeId == null) return false;
  return normalizeReticulumNodeId(nodeId) === selfNodeId;
}

/** Merge LXMF wire rows without flipping outbound DMs to inbound or dropping DM `to`. */
export function mergeReticulumIngestRecord(
  existing: MessageRecord | undefined,
  incoming: MessageRecord,
  payload: LxmfDirectionPayload,
  ctx: ReticulumIngestMergeContext = {},
): MessageRecord {
  const selfNodeId = ctx.selfLxmfHash
    ? normalizeReticulumNodeId(reticulumHashToNodeId(ctx.selfLxmfHash))
    : null;
  const record: MessageRecord = { ...incoming };

  if (payload.direction === 'outbound' && selfNodeId != null) {
    record.from = selfNodeId;
  }

  if (!existing) {
    if (ctx.attachmentPath) {
      record.reticulumAttachmentPath = ctx.attachmentPath;
      if (ctx.attachmentKind) record.reticulumAttachmentKind = ctx.attachmentKind;
      if (ctx.audioMode != null) record.reticulumAudioMode = ctx.audioMode;
    }
    return record;
  }

  const existingFromSelf = isSelfReticulumNode(existing.from, selfNodeId);
  const incomingFromSelf = isSelfReticulumNode(record.from, selfNodeId);

  if (existingFromSelf && payload.direction === 'inbound' && !incomingFromSelf) {
    return {
      ...existing,
      status: record.status === 'sending' ? existing.status : record.status,
    };
  }

  const merged: MessageRecord = { ...existing, ...record };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (existing.to != null && existing.to !== 0) {
    const mergedTo = merged.to;
    if (
      mergedTo === 0 ||
      (selfNodeId != null && normalizeReticulumNodeId(mergedTo) === selfNodeId)
    ) {
      merged.to = existing.to;
    }
  }

  if (existingFromSelf && !incomingFromSelf) {
    merged.from = existing.from;
    merged.senderName = existing.senderName;
    merged.reticulumSenderHash = existing.reticulumSenderHash ?? merged.reticulumSenderHash;
  } else if (existingFromSelf && incomingFromSelf && payload.direction === 'outbound') {
    merged.receivedVia = record.receivedVia ?? existing.receivedVia;
  }

  // HTTP/WS send echoes carry delivery_status=sending. Never demote a Completes row
  // (e.g. retry of another message must not flip a just-delivered bubble back to ⏳).
  if (existing.status === 'acked' && record.status === 'sending') {
    merged.status = 'acked';
    merged.error = undefined;
  }

  if (ctx.attachmentPath) {
    merged.reticulumAttachmentPath = ctx.attachmentPath;
    if (ctx.attachmentKind) merged.reticulumAttachmentKind = ctx.attachmentKind;
    if (ctx.audioMode != null) merged.reticulumAudioMode = ctx.audioMode;
  } else if (existing.reticulumAttachmentPath) {
    merged.reticulumAttachmentPath = existing.reticulumAttachmentPath;
    merged.reticulumAttachmentKind = existing.reticulumAttachmentKind;
    merged.reticulumAudioMode = existing.reticulumAudioMode;
    merged.reticulumAudioDurationSec = existing.reticulumAudioDurationSec;
  }

  // Keep quote metadata when a later wire tick omits preview fields.
  if (!merged.replyPreviewText && existing.replyPreviewText) {
    merged.replyPreviewText = existing.replyPreviewText;
  }
  if (!merged.replyPreviewSender && existing.replyPreviewSender) {
    merged.replyPreviewSender = existing.replyPreviewSender;
  }
  if (!merged.reticulumReplyToHash && existing.reticulumReplyToHash) {
    merged.reticulumReplyToHash = existing.reticulumReplyToHash;
  }

  return merged;
}
