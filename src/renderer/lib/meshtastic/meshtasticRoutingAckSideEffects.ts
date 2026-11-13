/**
 * Apply MeshPacket.ackProofStatus from ROUTING_APP ACKs onto outbound chat rows.
 */
import { updateMeshtasticDeliveryMeta } from '../../stores/messageStore';
import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import type { IdentityId } from '../types';
import { normalizeAckProofStatus } from './meshtasticAckProof';

/** Listen for Meshtastic routing ACKs and stamp ackProofStatus on the matched message. */
export function attachMeshtasticRoutingAckSideEffects(identityId: IdentityId): () => void {
  return attachTypedPacketListener(identityId, 'meshtastic_routing_ack', (payload) => {
    if (!payload.isAck) return;
    const messageId = String(payload.requestId >>> 0);
    updateMeshtasticDeliveryMeta(identityId, messageId, {
      ackProofStatus: normalizeAckProofStatus(payload.ackProofStatus),
    });
  });
}
