import {
  persistReticulumOutboundRecord,
  resolveReticulumOutboundSenderHash,
} from '@/renderer/lib/ingest/reticulumIngest';
import { resolveReticulumDestinationHash } from '@/renderer/lib/reticulum/destHash';
import type { IdentityId } from '@/renderer/lib/types';
import {
  type MessageRecord,
  type MessageStatus,
  updateMessageStatus,
  useMessageStore,
} from '@/renderer/stores/messageStore';
import { reticulumHashForNodeId } from '@/renderer/stores/reticulumPeerStore';

/** Map sidecar `lxmf_outbound_status` wire status to UI store status. */
export function mapLxmfOutboundWireStatus(wireStatus: string): MessageStatus {
  if (wireStatus === 'delivered') return 'acked';
  if (wireStatus === 'failed') return 'failed';
  return 'sending';
}

function resolveOutboundPeerHash(record: MessageRecord): string | null {
  if (record.to == null) return null;
  return reticulumHashForNodeId(record.to) ?? resolveReticulumDestinationHash(record.to);
}

function resolveOutboundSenderHash(record: MessageRecord): string | null {
  return (
    record.reticulumSenderHash ??
    resolveReticulumOutboundSenderHash(record.from) ??
    resolveReticulumDestinationHash(record.from)
  );
}

/**
 * Update Zustand and persist terminal delivery status to SQLite so restart
 * hydration / stale marking do not flip Completes to failed.
 */
export function persistReticulumOutboundMessageStatus(
  identityId: IdentityId,
  messageId: string,
  status: MessageStatus,
  errorMessage?: string,
): boolean {
  const before = useMessageStore.getState().messages[identityId]?.[messageId];
  if (!before) return false;
  updateMessageStatus(identityId, messageId, status, errorMessage);
  const record = useMessageStore.getState().messages[identityId]?.[messageId] ?? {
    ...before,
    status,
    ...(errorMessage !== undefined ? { error: errorMessage } : {}),
  };
  // Intermediate sending is already written on optimistic send; only flush terminals.
  if (status === 'sending') return true;
  const senderHash = resolveOutboundSenderHash(record);
  if (!senderHash) return true;
  persistReticulumOutboundRecord(
    identityId,
    record,
    senderHash,
    record.senderName ?? '',
    resolveOutboundPeerHash(record),
    status,
  );
  return true;
}

/** Apply sidecar Completes/Fails: store + SQLite. */
export function applyReticulumOutboundDeliveryStatus(
  identityId: IdentityId,
  messageHash: string,
  wireStatus: string,
): void {
  const status = mapLxmfOutboundWireStatus(wireStatus);
  persistReticulumOutboundMessageStatus(identityId, messageHash, status);
}
