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
import { errLikeToLogString } from '../errLikeToLogString';
import type { MeshtasticAckProofStatus } from '../meshtastic/meshtasticAckProof';
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
): { status?: string; to?: number; channelIndex?: number } | undefined {
  const messages = useMessageStore.getState().messages;
  if (!Object.hasOwn(messages, identityId)) return undefined;
  const bucket = messages[identityId];
  if (!Object.hasOwn(bucket, messageId)) return undefined;
  return bucket[messageId];
}

function isMeshcomDmRow(row: { to?: number; channelIndex?: number }): boolean {
  return row.channelIndex === -1;
}

/**
 * MeshCom radio ACKs are not Meshtastic cryptographic proofs — never stamp `valid`.
 * Successful peer receipt → `absent` (acked, unproven); NACK → `invalid`.
 */
function meshcomAckProofStatus(isAck: boolean): MeshtasticAckProofStatus {
  return isAck ? 'absent' : 'invalid';
}

/** Persist terminal status only — do not rewrite text / timestamp. */
function persistMeshcomTerminalStatus(
  identityId: IdentityId,
  messageId: string,
  status: 'acked' | 'failed',
): void {
  void window.electronAPI.db
    .updateMeshcomMessageStatus({
      identity_id: identityId,
      msg_id: messageId,
      status,
    })
    .catch((e: unknown) => {
      console.warn(
        '[meshcomRoutingAck] updateMeshcomMessageStatus failed ' + errLikeToLogString(e),
      );
    });
}

function settleOutboundStatus(
  identityId: IdentityId,
  messageId: string,
  status: 'acked' | 'failed',
): void {
  updateMessageStatus(identityId, messageId, status);
  persistMeshcomTerminalStatus(identityId, messageId, status);
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
    settleOutboundStatus(identityId, messageId, 'failed');
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
    const row = readOutboundRow(identityId, messageId);
    if (!row) return;
    // When the peer callsign/node is known, require it to match the outbound DM destination.
    if (
      isMeshcomDmRow(row) &&
      payload.from != null &&
      row.to != null &&
      payload.from >>> 0 !== row.to >>> 0
    ) {
      return;
    }
    clearDmAckTimer(identityId, messageId);
    updateMeshtasticDeliveryMeta(identityId, messageId, {
      ackProofStatus: meshcomAckProofStatus(payload.isAck),
    });
    if (payload.isAck) {
      if (row.status === 'sending' || row.status === 'failed') {
        settleOutboundStatus(identityId, messageId, 'acked');
      }
    } else if (row.status === 'sending') {
      settleOutboundStatus(identityId, messageId, 'failed');
    }
  });
}
