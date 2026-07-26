import { meshcoreContactRawFromDevice } from '../../hooks/meshcore/meshcoreHookPreamble';
import { usePathHistoryStore } from '../../stores/pathHistoryStore';
import { errLikeToLogString } from '../errLikeToLogString';
import type {
  MeshCoreConnection,
  MeshCoreContactRaw,
  MeshCoreSelfInfo,
} from '../meshcore/meshcoreHookTypes';
import { meshcoreContactOutPathBytesForTrace } from '../meshcoreRadioContactPath';
import { meshcoreInferHopsFromOutPath, pubkeyToNodeId } from '../meshcoreUtils';
import type { MeshNode } from '../types';

/** Path updates change hop counts; coalesce bursts before the full contact rebuild. */
export const MESHCORE_PATH_UPDATED_CONTACTS_REBUILD_DEBOUNCE_MS = 2000;

/**
 * Refresh outPath bytes for one contact after path-updated (129) so trace/ping can proceed.
 *
 * Failure point: `getContacts` timeout — logged; pending path update retried on debounced refresh.
 * Fallback: {@link rebuildMeshcoreContactsAfterPathUpdated}.
 */
export async function refreshMeshcoreOutPathAfterPathUpdated(
  conn: MeshCoreConnection,
  nodeId: number,
  outPathMapRef: Map<number, Uint8Array>,
  pathUpdatePending: Set<number>,
): Promise<void> {
  try {
    const contactsRaw = await conn.getContacts();
    const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
    for (const contact of contacts) {
      const cNodeId = pubkeyToNodeId(contact.publicKey);
      if (cNodeId !== nodeId) continue;
      const sliced = meshcoreContactOutPathBytesForTrace(contact);
      if (sliced.length > 0) {
        outPathMapRef.set(cNodeId, sliced);
        const pathBytes = Array.from(sliced);
        const hops = meshcoreInferHopsFromOutPath(contact) ?? Math.max(0, pathBytes.length - 1);
        usePathHistoryStore.getState().recordPathUpdated(cNodeId, pathBytes, hops, false);
        pathUpdatePending.delete(cNodeId);
      }
      break;
    }
  } catch (e) {
    console.warn(
      '[meshcorePathUpdatedRuntime] getContacts refresh failed ' + errLikeToLogString(e),
    );
  }
}

export interface MeshcoreContactsRebuildDeps {
  conn: MeshCoreConnection;
  buildNodesFromContacts: (
    contacts: MeshCoreContactRaw[],
    opts?: {
      self?: MeshCoreSelfInfo | null;
      myNodeId?: number;
      previousNodes?: Map<number, MeshNode>;
    },
  ) => Promise<Map<number, MeshNode>>;
  self: MeshCoreSelfInfo | null;
  myNodeId: number;
  previousNodes: Map<number, MeshNode>;
  /** Node ids that saw path-updated (129) since the last rebuild; consumed by this call. */
  pendingPathUpdateNodeIds: Set<number>;
  onContacts: (contacts: MeshCoreContactRaw[]) => void;
  onNodes: (nodes: Map<number, MeshNode>) => void;
  /** Re-queue pending ids when the rebuild throws so their path history isn't lost until the next 129. */
  onPendingRetained?: (nodeIds: Set<number>) => void;
}

/**
 * Full contact rebuild after a burst of path-updated (129) pushes, so hop counts and
 * `outPathLen` reflect the new routes and path history gets one row per updated node.
 *
 * Failure point: `getContacts` / rebuild rejection — logged; the previous node map stays in
 * place and the next path update schedules another rebuild.
 */
export async function rebuildMeshcoreContactsAfterPathUpdated(
  deps: MeshcoreContactsRebuildDeps,
): Promise<void> {
  try {
    const contactsRaw = await deps.conn.getContacts();
    const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
    deps.onContacts(contacts);
    const newNodes = await deps.buildNodesFromContacts(contacts, {
      self: deps.self,
      myNodeId: deps.myNodeId,
      previousNodes: deps.previousNodes,
    });
    deps.onNodes(newNodes);
    for (const contact of contacts) {
      const nodeId = pubkeyToNodeId(contact.publicKey);
      if (!deps.pendingPathUpdateNodeIds.has(nodeId)) continue;
      const sliced = meshcoreContactOutPathBytesForTrace(contact);
      if (sliced.length === 0) continue;
      usePathHistoryStore
        .getState()
        .recordPathUpdated(nodeId, Array.from(sliced), newNodes.get(nodeId)?.hops_away ?? 0, false);
    }
  } catch (e) {
    console.warn(
      '[meshcorePathUpdatedRuntime] debounced contacts refresh error ' + errLikeToLogString(e),
    );
    // The caller already drained these ids into a fresh set, so a rejection here would otherwise
    // discard them until another 129 arrives; hand them back so path history can retry.
    if (deps.pendingPathUpdateNodeIds.size > 0) {
      deps.onPendingRetained?.(deps.pendingPathUpdateNodeIds);
    }
  }
}
