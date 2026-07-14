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

function isTerminalStatus(status: MessageStatus): boolean {
  return status === 'acked' || status === 'failed';
}

/** Buffer for terminal WS statuses that arrive before optimistic rows are rekeyed. */
const PENDING_DELIVERY_STATUS_TTL_MS = 60_000;
const PENDING_DELIVERY_STATUS_MAX = 64;
const pendingDeliveryByKey = new Map<string, { wireStatus: string; receivedAt: number }>();

function pendingDeliveryKey(identityId: IdentityId, messageHash: string): string {
  return `${identityId}:${messageHash}`;
}

function prunePendingDeliveryStatuses(now = Date.now()): void {
  for (const [key, entry] of pendingDeliveryByKey) {
    if (now - entry.receivedAt > PENDING_DELIVERY_STATUS_TTL_MS) {
      pendingDeliveryByKey.delete(key);
    }
  }
  while (pendingDeliveryByKey.size > PENDING_DELIVERY_STATUS_MAX) {
    const oldest = pendingDeliveryByKey.keys().next().value;
    if (oldest == null) break;
    pendingDeliveryByKey.delete(oldest);
  }
}

function bufferPendingDeliveryStatus(
  identityId: IdentityId,
  messageHash: string,
  wireStatus: string,
): void {
  prunePendingDeliveryStatuses();
  pendingDeliveryByKey.set(pendingDeliveryKey(identityId, messageHash), {
    wireStatus,
    receivedAt: Date.now(),
  });
}

/**
 * Apply a previously buffered terminal status once the outbound row exists
 * under `messageHash` (e.g. after provisional id → LXMF hash rename).
 */
export function flushPendingReticulumOutboundDeliveryStatus(
  identityId: IdentityId,
  messageHash: string,
): boolean {
  const key = pendingDeliveryKey(identityId, messageHash);
  const pending = pendingDeliveryByKey.get(key);
  if (!pending) return false;
  const applied = persistReticulumOutboundMessageStatus(
    identityId,
    messageHash,
    mapLxmfOutboundWireStatus(pending.wireStatus),
  );
  if (applied) pendingDeliveryByKey.delete(key);
  return applied;
}

/** Test helper — clears buffered early terminal statuses. */
export function clearPendingReticulumOutboundDeliveryStatusesForTests(): void {
  pendingDeliveryByKey.clear();
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
  // Do not regress a terminal Completes/Fails back to sending.
  if (isTerminalStatus(before.status ?? 'sending') && status === 'sending') {
    return true;
  }
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

/** Apply sidecar Completes/Fails: store + SQLite (buffer if row not yet rekeyed). */
export function applyReticulumOutboundDeliveryStatus(
  identityId: IdentityId,
  messageHash: string,
  wireStatus: string,
): void {
  const status = mapLxmfOutboundWireStatus(wireStatus);
  const applied = persistReticulumOutboundMessageStatus(identityId, messageHash, status);
  if (applied) {
    pendingDeliveryByKey.delete(pendingDeliveryKey(identityId, messageHash));
    return;
  }
  if (isTerminalStatus(status)) {
    bufferPendingDeliveryStatus(identityId, messageHash, wireStatus);
  }
}
