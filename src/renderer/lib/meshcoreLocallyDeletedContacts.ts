/**
 * Node ids the user explicitly deleted from the MeshCore contact list.
 * Prevents `mergeMeshcoreChatStubNodes` / store upserts from resurrecting them until the
 * radio re-adds the contact (or the set is cleared via `clearMeshcoreLocallyDeletedContact`
 * when a live `getContacts` / `fromRadio` apply includes the id).
 */
const locallyDeleted = new Set<number>();

export function markMeshcoreLocallyDeletedContact(nodeId: number): void {
  if (nodeId > 0) locallyDeleted.add(nodeId >>> 0);
}

export function clearMeshcoreLocallyDeletedContact(nodeId: number): void {
  locallyDeleted.delete(nodeId >>> 0);
}

export function isMeshcoreLocallyDeletedContact(nodeId: number): boolean {
  return locallyDeleted.has(nodeId >>> 0);
}

/** True when UI/DB upsert paths may apply this contact id (not user-tombstoned). */
export function shouldApplyMeshcoreContact(nodeId: number): boolean {
  return nodeId > 0 && !isMeshcoreLocallyDeletedContact(nodeId);
}

export function filterOutMeshcoreLocallyDeletedContacts<T>(nodes: Map<number, T>): Map<number, T> {
  if (locallyDeleted.size === 0) return nodes;
  let changed = false;
  for (const id of locallyDeleted) {
    if (nodes.has(id)) {
      changed = true;
      break;
    }
  }
  if (!changed) return nodes;
  const next = new Map(nodes);
  for (const id of locallyDeleted) {
    next.delete(id);
  }
  return next;
}

/** Test helper — clears the in-memory deleted set. */
export function resetMeshcoreLocallyDeletedContactsForTests(): void {
  locallyDeleted.clear();
}
