import { pushAppToast } from '@/renderer/components/Toast';
import i18n from '@/renderer/lib/i18n';
import {
  persistReticulumOutboundRecord,
  resolveReticulumOutboundSenderHash,
} from '@/renderer/lib/ingest/reticulumIngest';
import {
  isReticulumViaLabel,
  reticulumViaToMessageTransport,
} from '@/renderer/lib/reticulum/classifyReticulumVia';
import { resolveReticulumDestinationHash } from '@/renderer/lib/reticulum/destHash';
import {
  isValidReticulumOutboundMessageHash,
  normalizeReticulumMessageHash,
} from '@/renderer/lib/reticulum/reticulumMessageHash';
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
import {
  isPnCascadeDeliveryMethod,
  parseReticulumDeliveryMethod,
} from '@/shared/reticulumDeliveryMethod';

/** Cap for sidecar `delivery_attempts` before store/SQLite patch. */
export const MAX_RETICULUM_DELIVERY_ATTEMPTS = 64;

function notifyTooLargeForPropagation(): void {
  pushAppToast(i18n.t('chatPanel.voiceMemo.tooLargeForPropagation'), 'info');
}

/** Map sidecar `lxmf_outbound_status` wire status to UI store status. Unknown → null. */
export function mapLxmfOutboundWireStatus(wireStatus: string): MessageStatus | null {
  if (wireStatus === 'delivered' || wireStatus === 'stored_locally') return 'acked';
  if (wireStatus === 'failed') return 'failed';
  if (wireStatus === 'sending') return 'sending';
  return null;
}

function clampDeliveryAttempts(value: number): number {
  return Math.min(MAX_RETICULUM_DELIVERY_ATTEMPTS, Math.max(0, Math.trunc(value)));
}

/** Resolve LXMF peer dest hash from a chat node id (peer store, then dest registry). */
export function resolveReticulumOutboundDestHash(
  toNodeId: number | undefined | null,
): string | null {
  if (toNodeId == null) return null;
  return reticulumHashForNodeId(toNodeId) ?? resolveReticulumDestinationHash(toNodeId);
}

function resolveOutboundPeerHash(record: MessageRecord): string | null {
  return resolveReticulumOutboundDestHash(record.to);
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

/** Buffer for terminal WS statuses that arrive before optimistic rows are rekeyed. */
const PENDING_DELIVERY_STATUS_TTL_MS = 60_000;
const PENDING_DELIVERY_STATUS_MAX = 64;
const pendingDeliveryByKey = new Map<
  string,
  {
    wireStatus: string;
    sentVia?: string;
    deliveryMethod?: string;
    deliveryAttempts?: number;
    error?: string;
    receivedAt: number;
  }
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
  deliveryAttempts?: number,
  error?: string,
): void {
  prunePendingDeliveryStatuses();
  pendingDeliveryByKey.set(pendingDeliveryKey(identityId, messageHash), {
    wireStatus,
    sentVia,
    deliveryMethod,
    deliveryAttempts,
    error,
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
  const mapped = mapLxmfOutboundWireStatus(pending.wireStatus);
  if (mapped == null) {
    pendingDeliveryByKey.delete(key);
    return false;
  }
  const errorMessage =
    mapped === 'failed' && pending.error === 'message_too_large_for_propagation'
      ? 'message_too_large_for_propagation'
      : undefined;
  const applied = persistReticulumOutboundMessageStatus(
    identityId,
    messageHash,
    mapped,
    errorMessage,
    parseWireSentVia(pending.sentVia),
    parseReticulumDeliveryMethod(pending.deliveryMethod),
    pending.deliveryAttempts,
  );
  if (applied) {
    pendingDeliveryByKey.delete(key);
    if (errorMessage === 'message_too_large_for_propagation') {
      notifyTooLargeForPropagation();
    }
  }
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
  deliveryAttempts?: number,
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
  const before = useMessageStore.getState().messages[identityId]?.[messageId];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (!before) return false;
  // Link-timeout failure bridge can mark Failed before WS Direct→PN fallback arrives.
  // Authoritative sending+propagated/stored_locally must revive so the badge is not stuck as PN ✗.
  if (
    before.status === 'failed' &&
    status === 'sending' &&
    isPnCascadeDeliveryMethod(deliveryMethod)
  ) {
    const revived: MessageRecord = {
      ...before,
      status: 'sending',
      error: undefined,
      reticulumDeliveryMethod: deliveryMethod,
      ...(sentVia != null ? { receivedVia: sentVia } : {}),
      ...(deliveryAttempts != null
        ? { reticulumDeliveryAttempts: clampDeliveryAttempts(deliveryAttempts) }
        : {}),
    };
    upsertMessage(identityId, revived);
    const senderHash = resolveOutboundSenderHash(revived);
    if (senderHash) {
      persistReticulumOutboundRecord(
        identityId,
        revived,
        senderHash,
        revived.senderName ?? '',
        resolveOutboundPeerHash(revived),
        'sending',
      );
    }
    return true;
  }
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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
  let record = useMessageStore.getState().messages[identityId]?.[messageId];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Store state may be externally mutated between reads.
  if (!record) return false;
  let patched = false;
  if (sentVia != null && sentVia !== record.receivedVia) {
    record = { ...record, receivedVia: sentVia };
    patched = true;
  }
  if (deliveryMethod != null && deliveryMethod !== record.reticulumDeliveryMethod) {
    record = { ...record, reticulumDeliveryMethod: deliveryMethod };
    patched = true;
  }
  if (
    deliveryAttempts != null &&
    Number.isFinite(deliveryAttempts) &&
    clampDeliveryAttempts(deliveryAttempts) !== record.reticulumDeliveryAttempts
  ) {
    record = { ...record, reticulumDeliveryAttempts: clampDeliveryAttempts(deliveryAttempts) };
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
  deliveryAttempts?: number | null;
  /** Sidecar terminal error code (e.g. message_too_large_for_propagation). */
  error?: string | null;
}

/** Apply sidecar Completes/Fails (and optional egress `sent_via`): store + SQLite. */
export function applyReticulumOutboundDeliveryStatus(
  identityId: IdentityId,
  messageHash: string,
  wireStatus: string,
  opts?: ApplyReticulumOutboundDeliveryStatusOpts,
): void {
  const normalizedHash = normalizeReticulumMessageHash(messageHash);
  if (!isValidReticulumOutboundMessageHash(normalizedHash)) {
    console.debug(
      `[applyReticulumOutboundDeliveryStatus] drop invalid message_hash len=${normalizedHash.length}`,
    );
    return;
  }
  const status = mapLxmfOutboundWireStatus(wireStatus);
  if (status == null) {
    console.debug(
      `[applyReticulumOutboundDeliveryStatus] drop unknown wire status=${wireStatus.slice(0, 32)}`,
    );
    return;
  }
  const sentVia = parseWireSentVia(opts?.sentVia);
  const deliveryMethod = parseReticulumDeliveryMethod(opts?.deliveryMethod);
  const deliveryAttempts =
    opts?.deliveryAttempts != null && Number.isFinite(opts.deliveryAttempts)
      ? clampDeliveryAttempts(opts.deliveryAttempts)
      : undefined;
  const errorMessage =
    status === 'failed' && opts?.error === 'message_too_large_for_propagation'
      ? 'message_too_large_for_propagation'
      : undefined;
  const applied = persistReticulumOutboundMessageStatus(
    identityId,
    normalizedHash,
    status,
    errorMessage,
    sentVia,
    deliveryMethod,
    deliveryAttempts,
  );
  if (applied) {
    pendingDeliveryByKey.delete(pendingDeliveryKey(identityId, normalizedHash));
    if (errorMessage === 'message_too_large_for_propagation') {
      notifyTooLargeForPropagation();
    }
    return;
  }
  // Terminal status, or egress/method upgrade before rekey for later flush.
  if (
    isTerminalStatus(status) ||
    sentVia != null ||
    deliveryMethod != null ||
    deliveryAttempts != null
  ) {
    bufferPendingDeliveryStatus(
      identityId,
      normalizedHash,
      wireStatus,
      opts?.sentVia ?? undefined,
      opts?.deliveryMethod ?? undefined,
      deliveryAttempts,
      opts?.error ?? undefined,
    );
  }
}
