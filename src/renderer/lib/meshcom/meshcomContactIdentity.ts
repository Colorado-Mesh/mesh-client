/**
 * Resolve which MeshCom identity bucket owns a contact for favorites / delete.
 * App Contacts (`nodesForUi`) reads {@link getIdentityIdForProtocol}; the session
 * ref may differ when offline hydration and RF connect use separate ids.
 */

import { type NodeRecord, useNodeStore } from '../../stores/nodeStore';
import { getIdentityIdForProtocol } from '../identityByProtocol';
import { getOfflineIdentityIdForProtocol } from '../offlineProtocolIdentities';
import type { IdentityId } from '../types';

export interface MeshcomContactIdentityHit {
  /** Bucket to patch / persist (prefers UI-facing id when the node lives there). */
  identityId: IdentityId;
  existing: NodeRecord | undefined;
  /**
   * When the node was found only in a non-UI bucket, also patch this id so
   * Contacts (`meshcomUiNodes`) updates immediately.
   */
  mirrorIdentityId?: IdentityId;
}

/**
 * Pick the store identity for a MeshCom contact action.
 * @param sessionIdentityId - `identityIdRef` / driver session from the runtime
 */
export function resolveMeshcomContactIdentity(
  nodeId: number,
  sessionIdentityId: IdentityId,
): MeshcomContactIdentityHit {
  const uiId = getIdentityIdForProtocol('meshcom') ?? sessionIdentityId;
  const offlineId = getOfflineIdentityIdForProtocol('meshcom');
  const nodes = useNodeStore.getState().nodes;
  const candidates = [...new Set([uiId, sessionIdentityId, offlineId])];

  for (const identityId of candidates) {
    if (!Object.hasOwn(nodes, identityId)) continue;
    const byId = nodes[identityId];
    // Record typing treats missing keys as present; require an own property.
    if (!Object.hasOwn(byId, nodeId)) continue;
    const existing = byId[nodeId];
    return {
      identityId,
      existing,
      mirrorIdentityId: identityId !== uiId ? uiId : undefined,
    };
  }

  return { identityId: uiId, existing: undefined };
}
