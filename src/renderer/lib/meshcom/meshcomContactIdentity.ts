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
  /** Bucket that currently holds the contact row (preferred for callsign / coords). */
  identityId: IdentityId;
  existing: NodeRecord | undefined;
  /**
   * Every MeshCom identity that must receive the favorited (or delete) mutation so
   * Contacts (`meshcomUiNodes` via {@link getIdentityIdForProtocol}) and the session /
   * offline slots stay aligned. Always includes the UI id.
   */
  syncIdentityIds: readonly IdentityId[];
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
  const syncIdentityIds = [...new Set([uiId, sessionIdentityId, offlineId])];

  let foundId: IdentityId | undefined;
  let existing: NodeRecord | undefined;
  for (const identityId of syncIdentityIds) {
    if (!Object.hasOwn(nodes, identityId)) continue;
    const byId = nodes[identityId];
    // Record typing treats missing keys as present; require an own property.
    if (!Object.hasOwn(byId, nodeId)) continue;
    foundId = identityId;
    existing = byId[nodeId];
    // Prefer the UI-facing bucket when multiple copies exist.
    if (identityId === uiId) break;
  }

  return {
    identityId: foundId ?? uiId,
    existing,
    syncIdentityIds,
  };
}
