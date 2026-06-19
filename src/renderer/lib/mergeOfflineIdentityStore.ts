import { upsertMessageRecordsForIdentity, useMessageStore } from '../stores/messageStore';
import { upsertNodeRecordsForIdentity, useNodeStore } from '../stores/nodeStore';
import { getOfflineIdentityIdForProtocol } from './offlineProtocolIdentities';
import type { IdentityId, MeshProtocol } from './types';

/**
 * When connect resolves to a non-offline identity but startup hydration landed on the
 * offline slot, merge offline nodes/messages into the live bucket so Chat and ingress agree.
 */
export function mergeOfflineStoreIntoIdentity(
  protocol: MeshProtocol,
  targetIdentityId: IdentityId,
): void {
  const offlineId = getOfflineIdentityIdForProtocol(protocol);
  if (targetIdentityId === offlineId) return;

  const messages = useMessageStore.getState().messages[offlineId];
  if (messages && Object.keys(messages).length > 0) {
    upsertMessageRecordsForIdentity(targetIdentityId, Object.values(messages));
  }

  const offlineNodes = useNodeStore.getState().nodes[offlineId];
  if (offlineNodes && Object.keys(offlineNodes).length > 0) {
    upsertNodeRecordsForIdentity(targetIdentityId, Object.values(offlineNodes));
  }
}
