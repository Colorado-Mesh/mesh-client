/**
 * Pure contact/history → node-store slice merge for Reticulum.
 * Used so unchanged refreshes can skip Zustand writes (and App shell re-renders).
 */

import { reticulumContactToNodeRecordPreservingLabel } from '@/renderer/stores/reticulumPeerStore';
import type { ReticulumContact } from '@/shared/reticulum-types';

import type { NodeRecord } from '../../stores/nodeStore';
import { reticulumHashToNodeId } from './destHash';

/** Reticulum-relevant fields that trigger a node-store write when they change. */
const COMPARE_FIELDS = [
  'reticulumDestinationHash',
  'longName',
  'shortName',
  'lastHeardAt',
  'hopsAway',
  'favorited',
] as const satisfies readonly (keyof NodeRecord)[];

export function buildReticulumContactNodeSlice(opts: {
  contacts: Iterable<ReticulumContact>;
  history: Iterable<ReticulumContact>;
  dismissed: ReadonlySet<string>;
  prior: Record<number, NodeRecord>;
  selfNodeId: number | null;
}): Record<number, NodeRecord> {
  const { contacts, history, dismissed, prior, selfNodeId } = opts;
  const records: NodeRecord[] = [];
  const keepNodeIds = new Set<number>();
  const seenHashes = new Set<string>();
  if (selfNodeId != null) keepNodeIds.add(selfNodeId);

  const consider = (contact: ReticulumContact, skipIfDismissed: boolean) => {
    const hash = contact.destination_hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
    if (seenHashes.has(hash)) return;
    if (skipIfDismissed && dismissed.has(hash)) return;
    seenHashes.add(hash);
    const nodeId = reticulumHashToNodeId(contact.destination_hash);
    records.push(reticulumContactToNodeRecordPreservingLabel(contact, prior[nodeId]));
    keepNodeIds.add(nodeId);
  };

  for (const contact of contacts) consider(contact, true);
  for (const contact of history) consider(contact, false);

  const next: Record<number, NodeRecord> = {};
  for (const [key, rec] of Object.entries(prior)) {
    const nodeId = Number(key);
    if (!rec.reticulumDestinationHash || keepNodeIds.has(nodeId)) {
      next[nodeId] = rec;
    }
  }
  for (const record of records) {
    const { nodeId, ...patch } = record;
    const definedPatch: Partial<NodeRecord> = {};
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      const value = patch[key];
      if (value !== undefined) {
        (definedPatch as Record<string, unknown>)[key] = value;
      }
    }
    const existing = Object.hasOwn(next, nodeId) ? next[nodeId] : { nodeId };
    next[nodeId] = { ...existing, ...definedPatch, nodeId };
  }
  return next;
}

function reticulumRelevantEqual(a: NodeRecord | undefined, b: NodeRecord | undefined): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  for (const field of COMPARE_FIELDS) {
    if (a[field] !== b[field]) return false;
  }
  return true;
}

/** True when both slices have the same keys and Reticulum-relevant field values. */
export function contactNodeSliceUnchanged(
  prior: Record<number, NodeRecord>,
  next: Record<number, NodeRecord>,
): boolean {
  const priorKeys = Object.keys(prior);
  const nextKeys = Object.keys(next);
  if (priorKeys.length !== nextKeys.length) return false;
  for (const key of nextKeys) {
    const nodeId = Number(key);
    if (!(key in prior)) return false;
    if (!reticulumRelevantEqual(prior[nodeId], next[nodeId])) return false;
  }
  return true;
}
