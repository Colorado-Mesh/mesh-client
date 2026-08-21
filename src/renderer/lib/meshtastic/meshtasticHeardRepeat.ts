import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import type { IdentityId } from '@/renderer/lib/types';
import { isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';

/** True when outbound chat is a channel/broadcast (not a DM). */
export function isMeshtasticBroadcastDestination(destination: number | undefined): boolean {
  if (destination == null) return true;
  return isMeshtasticBroadcastNodeNum(destination >>> 0);
}

/**
 * Start binary-heard tracking for an RF channel/broadcast send.
 * MQTT-only sends must not call this.
 */
export function markMeshtasticBroadcastPending(identityId: IdentityId, messageId: string): void {
  useRelayCoverageStore.getState().set(identityId, messageId, {
    protocol: 'meshtastic',
    mode: 'binary-heard',
    broadcastHeard: null,
  });
}

/** Routing ACK / sendText resolve for a tracked broadcast. */
export function markMeshtasticBroadcastHeard(identityId: IdentityId, messageId: string): void {
  const existing = useRelayCoverageStore.getState().coverageFor(identityId, messageId);
  if (existing?.protocol !== 'meshtastic' || existing.mode !== 'binary-heard') {
    return;
  }
  useRelayCoverageStore.getState().set(identityId, messageId, {
    protocol: 'meshtastic',
    mode: 'binary-heard',
    broadcastHeard: true,
  });
}

/** Routing timeout / sendText reject for a tracked broadcast. */
export function markMeshtasticBroadcastTimeout(identityId: IdentityId, messageId: string): void {
  const existing = useRelayCoverageStore.getState().coverageFor(identityId, messageId);
  if (existing?.protocol !== 'meshtastic' || existing.mode !== 'binary-heard') {
    return;
  }
  useRelayCoverageStore.getState().set(identityId, messageId, {
    protocol: 'meshtastic',
    mode: 'binary-heard',
    broadcastHeard: false,
  });
}

/**
 * Apply device transport status to relay coverage for broadcast rows only.
 * Re-keys tempId → wire id when the message store does.
 */
export function applyMeshtasticBroadcastTransportStatus(args: {
  identityId: IdentityId;
  transport: 'device' | 'mqtt';
  status: 'acked' | 'failed' | 'sending';
  messageIdBefore: string;
  messageIdAfter: string;
}): void {
  const { identityId, transport, status, messageIdBefore, messageIdAfter } = args;
  if (transport !== 'device') return;
  if (status !== 'acked' && status !== 'failed') return;

  const store = useRelayCoverageStore.getState();
  // Coverage may already have been re-keyed by messageStore.renameMessageId.
  const atBefore = store.coverageFor(identityId, messageIdBefore);
  const atAfter = store.coverageFor(identityId, messageIdAfter);
  const existing = atBefore ?? atAfter;
  if (existing?.protocol !== 'meshtastic' || existing.mode !== 'binary-heard') {
    return;
  }

  if (atBefore && messageIdBefore !== messageIdAfter) {
    store.renameMessage(identityId, messageIdBefore, messageIdAfter);
  }

  if (status === 'acked') {
    markMeshtasticBroadcastHeard(identityId, messageIdAfter);
  } else {
    markMeshtasticBroadcastTimeout(identityId, messageIdAfter);
  }
}
