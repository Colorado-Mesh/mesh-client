import { errLikeToLogString } from '../errLikeToLogString';
import { meshcoreRemoveContactErrorMessage, pubkeyToNodeId } from '../meshcoreUtils';
import type { MeshNode } from '../types';
import type { MeshCoreConnection, MeshcoreContactDbRow } from './meshcoreHookTypes';

/** MeshCore firmware contact type for repeaters (`ADV_TYPE_REPEATER`). */
export const MESHCORE_CONTACT_TYPE_REPEATER = 2;

export interface ClearMeshcoreRepeatersDeps {
  /** Live radio connection; `null` when disconnected (DB/UI-only clear). */
  conn: Pick<MeshCoreConnection, 'getContacts' | 'removeContact'> | null;
  selfNodeId: number;
  nodes: ReadonlyMap<number, Pick<MeshNode, 'hw_model' | 'favorited'>>;
  dbContacts: readonly Pick<MeshcoreContactDbRow, 'node_id' | 'contact_type' | 'favorited'>[];
  /** Deletes non-favorited repeater rows from SQLite (`db:clearMeshcoreRepeaters`). */
  clearDbRepeaters: () => Promise<unknown>;
}

export interface ClearMeshcoreRepeatersResult {
  /** Node ids the caller should drop from UI state and lookup maps. */
  removedNodeIds: number[];
  /** Radio `removeContact` / `getContacts` failures; removed contacts may return on refresh. */
  radioRemoveFailures: number;
}

/**
 * Remove every non-favorited repeater from the radio contact table, then SQLite.
 *
 * Failure point: individual radio removals may fail (contact may reappear on next
 * `getContacts`); those are counted and logged, and the clear continues. A DB failure
 * is logged and rethrown so the caller leaves UI state untouched.
 */
export async function clearMeshcoreRepeaters(
  deps: ClearMeshcoreRepeatersDeps,
): Promise<ClearMeshcoreRepeatersResult> {
  const { conn, selfNodeId, nodes, dbContacts, clearDbRepeaters } = deps;

  const favoritedIds = new Set<number>();
  for (const row of dbContacts) {
    if (row.favorited === 1) favoritedIds.add(row.node_id);
  }
  for (const [id, node] of nodes) {
    if (node.favorited) favoritedIds.add(id);
  }
  const keep = (id: number) => id === selfNodeId || favoritedIds.has(id);

  const removed = new Set<number>();
  for (const [id, node] of nodes) {
    if (node.hw_model === 'Repeater' && !keep(id)) removed.add(id);
  }
  for (const row of dbContacts) {
    if (row.contact_type === MESHCORE_CONTACT_TYPE_REPEATER && !keep(row.node_id)) {
      removed.add(row.node_id);
    }
  }

  let radioRemoveFailures = 0;
  if (conn) {
    try {
      const raw = await conn.getContacts();
      for (const c of raw) {
        if (c.type !== MESHCORE_CONTACT_TYPE_REPEATER) continue;
        const id = pubkeyToNodeId(c.publicKey);
        if (id === 0 || keep(id)) continue;
        try {
          await conn.removeContact(c.publicKey);
        } catch (e: unknown) {
          radioRemoveFailures += 1;
          console.warn(
            '[meshcoreClearRepeaters] removeContact error ' + meshcoreRemoveContactErrorMessage(e),
          );
        }
        removed.add(id);
      }
    } catch (e: unknown) {
      radioRemoveFailures += 1;
      console.warn('[meshcoreClearRepeaters] getContacts error ' + errLikeToLogString(e));
    }
  }

  try {
    await clearDbRepeaters();
  } catch (e: unknown) {
    console.warn(
      '[meshcoreClearRepeaters] clearMeshcoreRepeaters DB error ' + errLikeToLogString(e),
    );
    throw e instanceof Error ? e : new Error(String(e));
  }

  return { removedNodeIds: [...removed], radioRemoveFailures };
}
