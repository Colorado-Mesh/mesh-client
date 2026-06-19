import { type IdentityRecord, useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { getOfflineIdentityIdForProtocol } from './offlineProtocolIdentities';
import type { IdentityId, MeshProtocol } from './types';

export function countStoreKeys(map: Record<string, unknown> | undefined): number {
  return map ? Object.keys(map).length : 0;
}

function countIdentityBucket(
  map: Record<IdentityId, Record<string, unknown>> | undefined,
  identityId: IdentityId,
): number {
  return countStoreKeys(map?.[identityId]);
}

function hasConnectedTransport(
  identities: Record<IdentityId, IdentityRecord>,
  identityId: IdentityId,
): boolean {
  const rec = identities[identityId];
  return rec?.transports.some((t) => t.status === 'connected') ?? false;
}

/**
 * When connect created a fresh identity but SQLite hydration landed on the offline slot,
 * prefer the offline bucket so Chat / Repeaters see persisted data — but only before connect
 * populates the primary bucket, and never while a live transport is active on primary.
 */
function preferOfflineIdentityIfPrimaryEmpty(
  protocol: MeshProtocol,
  primaryId: IdentityId,
  identities: Record<IdentityId, IdentityRecord>,
): IdentityId {
  const offlineId = getOfflineIdentityIdForProtocol(protocol);
  if (primaryId === offlineId) return primaryId;

  if (hasConnectedTransport(identities, primaryId)) {
    return primaryId;
  }

  const nodes = useNodeStore.getState().nodes;
  const messages = useMessageStore.getState().messages;
  const primaryNodes = countIdentityBucket(nodes, primaryId);
  const offlineNodes = countIdentityBucket(nodes, offlineId);
  const primaryMsgs = countIdentityBucket(messages, primaryId);
  const offlineMsgs = countIdentityBucket(messages, offlineId);

  const primaryEmpty = primaryNodes === 0 && primaryMsgs === 0;
  const offlineHasData = offlineNodes > 0 || offlineMsgs > 0;
  if (primaryEmpty && offlineHasData) {
    return offlineId;
  }
  return primaryId;
}

/** Resolve primary identity id before offline fallback (for diagnostics). */
export function resolvePrimaryIdentityIdForProtocol(
  identities: Record<IdentityId, IdentityRecord>,
  activeIdentityId: IdentityId | null,
  protocol: MeshProtocol,
): IdentityId | null {
  if (activeIdentityId) {
    const active = identities[activeIdentityId];
    if (active?.protocol.type === protocol) return activeIdentityId;
  }
  const matches = Object.values(identities)
    .filter((i) => i.protocol.type === protocol)
    .sort((a, b) => a.createdAt - b.createdAt);
  return matches[0]?.id ?? null;
}

/** Active or earliest-created identity for a protocol tab (deterministic when multiple exist). */
export function resolveIdentityIdForProtocol(
  identities: Record<IdentityId, IdentityRecord>,
  activeIdentityId: IdentityId | null,
  protocol: MeshProtocol,
): IdentityId | null {
  const resolved = resolvePrimaryIdentityIdForProtocol(identities, activeIdentityId, protocol);
  if (!resolved) return null;
  return preferOfflineIdentityIfPrimaryEmpty(protocol, resolved, identities);
}

/** Active or earliest-created identity for a protocol tab (deterministic when multiple exist). */
export function getIdentityIdForProtocol(protocol: MeshProtocol): IdentityId | null {
  const { identities, activeIdentityId } = useIdentityStore.getState();
  return resolveIdentityIdForProtocol(identities, activeIdentityId, protocol);
}
