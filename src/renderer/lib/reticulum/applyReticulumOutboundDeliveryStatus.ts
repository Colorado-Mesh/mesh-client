import {
  persistReticulumOutboundRecord,
  resolveReticulumOutboundSenderHash,
} from '@/renderer/lib/ingest/reticulumIngest';
import {
  isReticulumViaLabel,
  reticulumViaToMessageTransport,
} from '@/renderer/lib/reticulum/classifyReticulumVia';
import { resolveReticulumDestinationHash } from '@/renderer/lib/reticulum/destHash';
import type { IdentityId } from '@/renderer/lib/types';
import {
  type MessageRecord,
  type MessageStatus,
  type MessageTransport,
  updateMessageStatus,
  upsertMessage,
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

function parseWireSentVia(sentVia: string | undefined | null): MessageTransport | undefined {
  if (sentVia == null || sentVia === '') return undefined;
  if (!isReticulumViaLabel(sentVia)) return undefined;
  return reticulumViaToMessageTransport(sentVia);
}

function parseWireDeliveryMethod(
  value: string | undefined | null,
): MessageRecord['reticulumDeliveryMethod'] {
  if (value === 'direct' || value === 'propagated' || value === 'opportunistic') return value;
  return undefined;
}

/** Buffer for terminal WS statuses that arrive before optimistic rows are rekeyed. */
const PENDING_DELIVERY_STATUS_TTL_MS = 60_000;
const PENDING_DELIVERY_STATUS_MAX = 64;
const pendingDeliveryByKey = new Map<
  string,
  { wireStatus: string; sentVia?: string; deliveryMethod?: string; receivedAt: number }
>();

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
  sentVia?: string,
  deliveryMethod?: string,
): void {
  prunePendingDeliveryStatuses();
  pendingDeliveryByKey.set(pendingDeliveryKey(identityId, messageHash), {
    wireStatus,
    sentVia,
    deliveryMethod,
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
    undefined,
    parseWireSentVia(pending.sentVia),
    parseWireDeliveryMethod(pending.deliveryMethod),
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
 * When `sentVia` is set (egress evidence upgrade), also patch store + SQLite `received_via`.
 * When `deliveryMethod` is set (Direct→PN fallback), patch `reticulumDeliveryMethod`.
 */
export function persistReticulumOutboundMessageStatus(
  identityId: IdentityId,
  messageId: string,
  status: MessageStatus,
  errorMessage?: string,
  sentVia?: MessageTransport,
  deliveryMethod?: MessageRecord['reticulumDeliveryMethod'],
): boolean {
  const before = useMessageStore.getState().messages[identityId]?.[messageId];
  if (!before) return false;
  // Do not regress a terminal Completes/Fails back to sending — still allow via/method patches.
  if (isTerminalStatus(before.status ?? 'sending') && status === 'sending') {
    const viaChanged = sentVia != null && sentVia !== before.receivedVia;
    const methodChanged =
      deliveryMethod != null && deliveryMethod !== before.reticulumDeliveryMethod;
    if (viaChanged || methodChanged) {
      const patched: MessageRecord = {
        ...before,
        ...(viaChanged ? { receivedVia: sentVia } : {}),
        ...(methodChanged ? { reticulumDeliveryMethod: deliveryMethod } : {}),
      };
      upsertMessage(identityId, patched);
      const senderHash = resolveOutboundSenderHash(patched);
      if (senderHash) {
        persistReticulumOutboundRecord(
          identityId,
          patched,
          senderHash,
          patched.senderName ?? '',
          resolveOutboundPeerHash(patched),
          before.status ?? 'sending',
        );
      }
    }
    return true;
  }
  updateMessageStatus(identityId, messageId, status, errorMessage);
  let record = useMessageStore.getState().messages[identityId]?.[messageId] ?? {
    ...before,
    status,
    ...(errorMessage !== undefined ? { error: errorMessage } : {}),
  };
  let patched = false;
  if (sentVia != null && sentVia !== record.receivedVia) {
    record = { ...record, receivedVia: sentVia };
    patched = true;
  }
  if (deliveryMethod != null && deliveryMethod !== record.reticulumDeliveryMethod) {
    record = { ...record, reticulumDeliveryMethod: deliveryMethod };
    patched = true;
  }
  if (patched) {
    upsertMessage(identityId, record);
  }
  // Intermediate sending without via/method change is already written on optimistic send.
  if (status === 'sending' && sentVia == null && deliveryMethod == null) return true;
  if (status === 'sending') {
    const senderHash = resolveOutboundSenderHash(record);
    if (senderHash) {
      persistReticulumOutboundRecord(
        identityId,
        record,
        senderHash,
        record.senderName ?? '',
        resolveOutboundPeerHash(record),
        status,
      );
    }
    return true;
  }
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

export interface ApplyReticulumOutboundDeliveryStatusOpts {
  sentVia?: string | null;
  deliveryMethod?: string | null;
}

/** Apply sidecar Completes/Fails (and optional egress `sent_via`): store + SQLite. */
export function applyReticulumOutboundDeliveryStatus(
  identityId: IdentityId,
  messageHash: string,
  wireStatus: string,
  opts?: ApplyReticulumOutboundDeliveryStatusOpts,
): void {
  const status = mapLxmfOutboundWireStatus(wireStatus);
  const sentVia = parseWireSentVia(opts?.sentVia);
  const deliveryMethod = parseWireDeliveryMethod(opts?.deliveryMethod);
  const applied = persistReticulumOutboundMessageStatus(
    identityId,
    messageHash,
    status,
    undefined,
    sentVia,
    deliveryMethod,
  );
  if (applied) {
    pendingDeliveryByKey.delete(pendingDeliveryKey(identityId, messageHash));
    return;
  }
  // Terminal status, or egress/method upgrade before rekey for later flush.
  if (isTerminalStatus(status) || sentVia != null || deliveryMethod != null) {
    bufferPendingDeliveryStatus(
      identityId,
      messageHash,
      wireStatus,
      opts?.sentVia ?? undefined,
      opts?.deliveryMethod ?? undefined,
    );
  }
}
