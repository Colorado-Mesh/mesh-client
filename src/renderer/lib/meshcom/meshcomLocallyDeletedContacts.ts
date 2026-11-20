/**
 * Callsigns the user explicitly deleted from the MeshCom contact list.
 * Prevents ingest upserts / SQLite contact writes from resurrecting them until
 * the set is cleared (or the process restarts — session-only, unlike MeshCore).
 */

import { normalizeMeshcomCallsign } from './meshcomCallsign';

const locallyDeleted = new Set<string>();

function keyForCallsign(callsign: string): string | null {
  const normalized = normalizeMeshcomCallsign(callsign);
  return normalized || null;
}

export function markMeshcomLocallyDeletedContact(callsign: string): void {
  const key = keyForCallsign(callsign);
  if (key) locallyDeleted.add(key);
}

export function clearMeshcomLocallyDeletedContact(callsign: string): void {
  const key = keyForCallsign(callsign);
  if (key) locallyDeleted.delete(key);
}

export function isMeshcomLocallyDeletedContact(callsign: string): boolean {
  const key = keyForCallsign(callsign);
  return key != null && locallyDeleted.has(key);
}

/** True when ingest may persist/upsert this callsign (not user-tombstoned). */
export function shouldApplyMeshcomContact(callsign: string): boolean {
  const key = keyForCallsign(callsign);
  return key != null && !locallyDeleted.has(key);
}

/** Test helper — clear all tombstones. */
export function clearAllMeshcomLocallyDeletedContactsForTests(): void {
  locallyDeleted.clear();
}
