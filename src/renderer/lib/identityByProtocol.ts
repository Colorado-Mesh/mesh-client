import { type IdentityRecord, useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { getOfflineIdentityIdForProtocol } from './offlineProtocolIdentities';
import type { IdentityId, MeshProtocol } from './types';

function countStoreKeys(map: Record<string, unknown> | undefined): number {
  return map ? Object.keys(map).length : 0;
}

/**
 * When connect created a fresh identity but SQLite hydration landed on the offline slot,
 * prefer the offline bucket so Chat / Repeaters see persisted data.
 */
function preferOfflineIdentityIfPrimaryEmpty(
  protocol: MeshProtocol,
  primaryId: IdentityId,
): IdentityId {
  const offlineId = getOfflineIdentityIdForProtocol(protocol);
  if (primaryId === offlineId) return primaryId;
  const nodes = useNodeStore.getState().nodes;
  const messages = useMessageStore.getState().messages;
  const primaryNodes = countStoreKeys(nodes[primaryId]);
  const offlineNodes = countStoreKeys(nodes[offlineId]);
  const primaryMsgs = countStoreKeys(messages[primaryId]);
  const offlineMsgs = countStoreKeys(messages[offlineId]);
  if ((primaryNodes === 0 && offlineNodes > 0) || (primaryMsgs === 0 && offlineMsgs > 0)) {
    return offlineId;
  }
  return primaryId;
}

/** Active or earliest-created identity for a protocol tab (deterministic when multiple exist). */
export function resolveIdentityIdForProtocol(
  identities: Record<IdentityId, IdentityRecord>,
  activeIdentityId: IdentityId | null,
  protocol: MeshProtocol,
): IdentityId | null {
  let resolved: IdentityId | null = null;
  if (activeIdentityId) {
    const active = identities[activeIdentityId];
    if (active?.protocol.type === protocol) resolved = activeIdentityId;
  }
  if (!resolved) {
    const matches = Object.values(identities)
      .filter((i) => i.protocol.type === protocol)
      .sort((a, b) => a.createdAt - b.createdAt);
    resolved = matches[0]?.id ?? null;
  }
  if (!resolved) return null;
  return preferOfflineIdentityIfPrimaryEmpty(protocol, resolved);
}

/** Active or earliest-created identity for a protocol tab (deterministic when multiple exist). */
export function getIdentityIdForProtocol(protocol: MeshProtocol): IdentityId | null {
  const { identities, activeIdentityId } = useIdentityStore.getState();
  return resolveIdentityIdForProtocol(identities, activeIdentityId, protocol);
}
