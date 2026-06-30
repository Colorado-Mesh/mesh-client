import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { computeReticulumMessageHash } from '@/renderer/lib/reticulum/messageHash';
import { reticulumDbRowToMessageRecord } from '@/renderer/lib/storeRecordAdapters';
import type { IdentityId } from '@/renderer/lib/types';
import type { MessageRecord } from '@/renderer/stores/messageStore';
import { addMessage, upsertMessage } from '@/renderer/stores/messageStore';

export interface ReticulumLxmfPayload {
  sender_hash?: string;
  sender_name?: string;
  text?: string;
  timestamp?: number;
  to_hash?: string;
  reply_to_hash?: string;
  message_hash?: string;
  direction?: string;
  reaction_target?: string;
}

function payloadToMessageRecord(p: ReticulumLxmfPayload): MessageRecord | null {
  if (!p.text || !p.sender_hash) return null;

  const senderNodeId = reticulumHashToNodeId(p.sender_hash);
  registerReticulumDestinationHash(senderNodeId, p.sender_hash);
  const timestamp = p.timestamp ?? Date.now();
  const messageHash =
    p.message_hash ?? computeReticulumMessageHash(p.sender_hash, timestamp, p.text);

  const isReaction = Boolean(p.reaction_target);

  return {
    id: messageHash,
    from: senderNodeId,
    senderName: p.sender_name ?? p.sender_hash.slice(0, 12),
    to: p.to_hash ? reticulumHashToNodeId(p.to_hash) : 0,
    payload: p.text,
    channelIndex: 0,
    timestamp,
    status: 'acked',
    reticulumMessageHash: messageHash,
    reticulumSenderHash: p.sender_hash,
    ...(p.reply_to_hash ? { reticulumReplyToHash: p.reply_to_hash } : {}),
    ...(isReaction ? { tapback: true, reticulumReplyToHash: p.reaction_target } : {}),
  };
}

export function ingestReticulumLxmfPayload(
  identityId: IdentityId,
  p: ReticulumLxmfPayload,
): boolean {
  const record = payloadToMessageRecord(p);
  if (!record) return false;
  upsertMessage(identityId, record);
  return true;
}

export async function persistReticulumMessageToDb(
  identityId: IdentityId,
  p: ReticulumLxmfPayload,
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
    });
  } catch (e) {
    console.warn('[reticulumIngest] save message ' + errLikeToLogString(e));
  }
}

export async function persistReticulumContactFromPayload(p: ReticulumLxmfPayload): Promise<void> {
  if (!p.sender_hash) return;
  try {
    await window.electronAPI.db.upsertReticulumDestination({
      destination_hash: p.sender_hash,
      display_name: p.sender_name ?? p.sender_hash.slice(0, 12),
      last_heard: Math.floor((p.timestamp ?? Date.now()) / 1000),
    });
  } catch (e) {
    console.warn('[reticulumIngest] upsert contact ' + errLikeToLogString(e));
  }
}

export function ingestReticulumLxmfPayloadWithSideEffects(
  identityId: IdentityId,
  p: ReticulumLxmfPayload,
): boolean {
  const ingested = ingestReticulumLxmfPayload(identityId, p);
  if (!ingested) return false;
  void persistReticulumMessageToDb(identityId, p);
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
  }[],
): void {
  for (const row of rows) {
    addMessage(identityId, reticulumDbRowToMessageRecord(row));
  }
}
