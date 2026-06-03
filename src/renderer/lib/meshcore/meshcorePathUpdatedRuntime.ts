import { meshcoreContactRawFromDevice } from '../../hooks/meshcore/meshcoreHookPreamble';
import { usePathHistoryStore } from '../../stores/pathHistoryStore';
import { errLikeToLogString } from '../errLikeToLogString';
import type { MeshCoreConnection } from '../meshcore/meshcoreHookTypes';
import {
  meshcoreInferHopsFromOutPath,
  meshcoreSliceContactOutPathForTrace,
  pubkeyToNodeId,
} from '../meshcoreUtils';

/**
 * Refresh outPath bytes for one contact after path-updated (129) so trace/ping can proceed.
 *
 * Failure point: `getContacts` timeout — logged; pending path update retried on debounced refresh.
 * Fallback: debounced full contact rebuild in legacy conn events.
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
      const sliced = meshcoreSliceContactOutPathForTrace(contact.outPath, contact.outPathLen);
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
