import type { MessageRecord } from '@/renderer/stores/messageStore';

import { normalizeReticulumNodeId, reticulumHashToNodeId } from './destHash';

export interface ReticulumIngestMergeContext {
  selfLxmfHash?: string | null;
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

  if (!existing) return record;

  const existingFromSelf = isSelfReticulumNode(existing.from, selfNodeId);
  const incomingFromSelf = isSelfReticulumNode(record.from, selfNodeId);

  if (existingFromSelf && payload.direction === 'inbound' && !incomingFromSelf) {
    return {
      ...existing,
      status: record.status === 'sending' ? existing.status : record.status,
    };
  }

  const merged: MessageRecord = { ...existing, ...record };

  if (existing.to != null && existing.to !== 0) {
    const mergedTo = merged.to ?? 0;
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
    merged.receivedVia = existing.receivedVia ?? record.receivedVia;
  }

  return merged;
}
