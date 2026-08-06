/**
 * Node ids the user explicitly deleted from the MeshCore contact list.
 * Prevents `mergeMeshcoreChatStubNodes` / store upserts from resurrecting them until the
 * radio re-adds the contact (or the set is cleared via `clearMeshcoreLocallyDeletedContact`
 * when a live `getContacts` / `fromRadio` apply includes the id).
 *
 * Persisted in localStorage so tombstones survive renderer restart before hydration.
 */
const STORAGE_KEY = 'mesh-client:meshcoreLocallyDeletedContacts';

/** Valid MeshCore contact node ids are uint32 in 1..=0xffffffff (not zero). */
const MAX_MESHCORE_NODE_ID = 0xffffffff;

const locallyDeleted = new Set<number>();
let hydratedFromStorage = false;

function isValidMeshcoreTombstoneId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= MAX_MESHCORE_NODE_ID;
}

function persistLocallyDeleted(): void {
  try {
    const ids = [...locallyDeleted];
    if (ids.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (e) {
    console.debug('[meshcoreLocallyDeletedContacts] persist failed', e);
  }
}

/** Restore tombstones from localStorage (idempotent). Call before contact/message hydration. */
export function restoreMeshcoreLocallyDeletedContactsFromStorage(): void {
  if (hydratedFromStorage) return;
  hydratedFromStorage = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const id of parsed) {
      if (isValidMeshcoreTombstoneId(id)) {
        locallyDeleted.add(id);
      }
    }
  } catch (e) {
    console.debug('[meshcoreLocallyDeletedContacts] restore failed', e);
  }
}

export function markMeshcoreLocallyDeletedContact(nodeId: number): void {
  restoreMeshcoreLocallyDeletedContactsFromStorage();
  if (isValidMeshcoreTombstoneId(nodeId)) {
    locallyDeleted.add(nodeId);
    persistLocallyDeleted();
  }
}

export function clearMeshcoreLocallyDeletedContact(nodeId: number): void {
  restoreMeshcoreLocallyDeletedContactsFromStorage();
  if (isValidMeshcoreTombstoneId(nodeId)) {
    locallyDeleted.delete(nodeId);
    persistLocallyDeleted();
  }
}

export function isMeshcoreLocallyDeletedContact(nodeId: number): boolean {
  restoreMeshcoreLocallyDeletedContactsFromStorage();
  return isValidMeshcoreTombstoneId(nodeId) && locallyDeleted.has(nodeId);
}

/** True when UI/DB upsert paths may apply this contact id (not user-tombstoned). */
export function shouldApplyMeshcoreContact(nodeId: number): boolean {
  return nodeId > 0 && !isMeshcoreLocallyDeletedContact(nodeId);
}

export function filterOutMeshcoreLocallyDeletedContacts<T>(nodes: Map<number, T>): Map<number, T> {
  restoreMeshcoreLocallyDeletedContactsFromStorage();
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

/** Test helper — clears the in-memory deleted set and storage. */
export function resetMeshcoreLocallyDeletedContactsForTests(): void {
  locallyDeleted.clear();
  hydratedFromStorage = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // catch-no-log-ok jsdom localStorage may be unavailable in some harnesses
  }
}
