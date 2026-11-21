/**
 * Apply MeshCom routing / DM ACK events onto outbound chat rows.
 * Firmware emits ACK frames (BLE phone 0x41, KISS ackNN) as `meshtastic_routing_ack`
 * with requestId = message number (matches sendMessage packetId).
 */

import { MS_PER_MINUTE } from '@/shared/timeConstants';

import {
  updateMeshtasticDeliveryMeta,
  updateMessageStatus,
  useMessageStore,
} from '../../stores/messageStore';
import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import { normalizeAckProofStatus } from '../meshtastic/meshtasticAckProof';
import type { IdentityId } from '../types';

/** FAQ: undelivered DM after ~6 minutes. */
export const MESHCOM_DM_ACK_TIMEOUT_MS = 6 * MS_PER_MINUTE;

const pendingDmTimers = new Map<string, ReturnType<typeof setTimeout>>();

function timerKey(identityId: IdentityId, messageId: string): string {
  return `${identityId}\0${messageId}`;
}

function clearDmAckTimer(identityId: IdentityId, messageId: string): void {
  const key = timerKey(identityId, messageId);
  const timer = pendingDmTimers.get(key);
  if (timer != null) {
    clearTimeout(timer);
    pendingDmTimers.delete(key);
  }
}

function readOutboundRow(
  identityId: IdentityId,
  messageId: string,
): { status?: string } | undefined {
  const messages = useMessageStore.getState().messages;
  if (!Object.hasOwn(messages, identityId)) return undefined;
  const bucket = messages[identityId];
  if (!Object.hasOwn(bucket, messageId)) return undefined;
  return bucket[messageId];
}

/**
 * After a MeshCom DM send succeeds on the wire, keep the row `sending` until an ACK
 * arrives (or {@link MESHCOM_DM_ACK_TIMEOUT_MS} elapses).
 */
export function scheduleMeshcomDmAckTimeout(identityId: IdentityId, messageId: string): void {
  clearDmAckTimer(identityId, messageId);
  const key = timerKey(identityId, messageId);
  const timer = setTimeout(() => {
    pendingDmTimers.delete(key);
    const row = readOutboundRow(identityId, messageId);
    if (row?.status !== 'sending') return;
    updateMessageStatus(identityId, messageId, 'failed');
  }, MESHCOM_DM_ACK_TIMEOUT_MS);
  pendingDmTimers.set(key, timer);
}

/** Cancel a pending DM ACK timer (tests / successful ACK). */
export function cancelMeshcomDmAckTimeout(identityId: IdentityId, messageId: string): void {
  clearDmAckTimer(identityId, messageId);
}

/** Clear all pending MeshCom DM ACK timers (tests). */
export function clearAllMeshcomDmAckTimeouts(): void {
  for (const timer of pendingDmTimers.values()) clearTimeout(timer);
  pendingDmTimers.clear();
}

/** Listen for MeshCom routing ACKs and settle matching outbound chat rows. */
export function attachMeshcomRoutingAckSideEffects(identityId: IdentityId): () => void {
  return attachTypedPacketListener(identityId, 'meshtastic_routing_ack', (payload) => {
    const messageId = String(payload.requestId >>> 0);
    clearDmAckTimer(identityId, messageId);
    const proof = normalizeAckProofStatus(payload.isAck ? 1 : 0);
    updateMeshtasticDeliveryMeta(identityId, messageId, { ackProofStatus: proof });
    const row = readOutboundRow(identityId, messageId);
    if (!row) return;
    if (payload.isAck) {
      if (row.status === 'sending' || row.status === 'failed') {
        updateMessageStatus(identityId, messageId, 'acked');
      }
    } else if (row.status === 'sending') {
      updateMessageStatus(identityId, messageId, 'failed');
    }
  });
}
