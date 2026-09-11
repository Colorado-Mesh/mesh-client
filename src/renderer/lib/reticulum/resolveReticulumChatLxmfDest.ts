/**
 * Chat must target `lxmf.delivery` destinations only.
 * Path-table peers include every RNS aspect (e.g. `lxst.telephony`); messaging those
 * as LXMF yields Direct link timeouts while announces/Nomad/RRC still look healthy.
 */

import {
  normalizeReticulumNodeId,
  resolveReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { LXST_TELEPHONY_ASPECT } from '@/renderer/lib/reticulumVoiceCapability';
import {
  type ReticulumIdentityActivityRow,
  useReticulumIdentityActivityStore,
} from '@/renderer/stores/reticulumIdentityActivityStore';
import {
  reticulumHashForNodeId,
  useReticulumPeerStore,
} from '@/renderer/stores/reticulumPeerStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

export const LXMF_DELIVERY_ASPECT = 'lxmf.delivery';

export type ResolveReticulumChatLxmfDestResult =
  | { status: 'ok'; hash: string; remapped: boolean }
  | { status: 'invalid' }
  | { status: 'missing_lxmf' };

function normalizeHash(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function activityHasAspect(rows: ReticulumIdentityActivityRow[], aspect: string): boolean {
  return rows.some((r) => r.aspect === aspect);
}

function identityFromActivity(rows: ReticulumIdentityActivityRow[]): string | null {
  for (const row of rows) {
    const id = row.identity_hash ? canonicalizeReticulumDestinationHash(row.identity_hash) : null;
    if (id) return id;
  }
  return null;
}

/** Find `lxmf.delivery` destination announced for this RNS identity. */
export function findLxmfDeliveryHashForIdentity(
  identityHash: string,
  activityByDestination: ReadonlyMap<
    string,
    ReticulumIdentityActivityRow[]
  > = useReticulumIdentityActivityStore.getState().byDestination,
): string | null {
  const id = canonicalizeReticulumDestinationHash(identityHash);
  if (!id) return null;
  let best: { hash: string; lastSeen: number } | null = null;
  for (const [dest, rows] of activityByDestination) {
    for (const row of rows) {
      if (row.aspect !== LXMF_DELIVERY_ASPECT) continue;
      const rowId = row.identity_hash
        ? canonicalizeReticulumDestinationHash(row.identity_hash)
        : null;
      if (rowId !== id) continue;
      const hash = normalizeHash(row.destination_hash || dest);
      if (!canonicalizeReticulumDestinationHash(hash)) continue;
      if (!best || row.last_seen > best.lastSeen) {
        best = { hash, lastSeen: row.last_seen };
      }
    }
  }
  return best?.hash ?? null;
}

function peerIdentityHint(hash: string): string | null {
  const store = useReticulumPeerStore.getState();
  const key = normalizeHash(hash);
  const peer = store.contacts.get(key) ?? store.history.get(key) ?? store.peers.get(key);
  return peer?.identity_hash ? canonicalizeReticulumDestinationHash(peer.identity_hash) : null;
}

/**
 * True when `hash` is known as an RNS identity (appears as `identity_hash` on activity
 * or peer rows), not merely as a destination aspect hash.
 */
export function isKnownRnsIdentityHash(
  hash: string,
  activityByDestination: ReadonlyMap<
    string,
    ReticulumIdentityActivityRow[]
  > = useReticulumIdentityActivityStore.getState().byDestination,
): boolean {
  const id = canonicalizeReticulumDestinationHash(hash);
  if (!id) return false;
  for (const rows of activityByDestination.values()) {
    for (const row of rows) {
      const rowId = row.identity_hash
        ? canonicalizeReticulumDestinationHash(row.identity_hash)
        : null;
      if (rowId === id) return true;
    }
  }
  const store = useReticulumPeerStore.getState();
  for (const map of [store.contacts, store.history, store.peers]) {
    for (const peer of map.values()) {
      const peerId = peer.identity_hash
        ? canonicalizeReticulumDestinationHash(peer.identity_hash)
        : null;
      if (peerId === id) return true;
    }
  }
  return false;
}

function resolveIdentityHashToLxmf(
  identityHash: string,
  activityByDestination: ReadonlyMap<string, ReticulumIdentityActivityRow[]>,
): ResolveReticulumChatLxmfDestResult {
  const lxmf = findLxmfDeliveryHashForIdentity(identityHash, activityByDestination);
  if (lxmf) {
    return {
      status: 'ok',
      hash: lxmf,
      remapped: lxmf !== identityHash,
    };
  }
  return { status: 'missing_lxmf' };
}

/**
 * Resolve a path-table / pasted / registry destination to the peer's LXMF delivery hash.
 *
 * - Already `lxmf.delivery` → use as-is.
 * - Bare RNS **identity** hash (known via activity/peer `identity_hash`) → remap to that
 *   identity's `lxmf.delivery`, or `missing_lxmf` when none heard yet.
 * - `lxst.telephony` / other non-lxmf with known identity → remap to that identity's lxmf.delivery.
 * - Non-lxmf with no lxmf.delivery heard → `missing_lxmf` (do not send).
 * - No aspect known yet (pasted LXMF / path-table before activity lands) → allow as-is.
 */
export function resolveReticulumChatLxmfDestination(
  candidateHash: string,
): ResolveReticulumChatLxmfDestResult {
  const canonical = canonicalizeReticulumDestinationHash(candidateHash);
  if (!canonical) return { status: 'invalid' };

  const activityStore = useReticulumIdentityActivityStore.getState();
  const rows = activityStore.getActivity(canonical);
  if (activityHasAspect(rows, LXMF_DELIVERY_ASPECT)) {
    return { status: 'ok', hash: canonical, remapped: false };
  }

  // Pasted / opened RNS identity hash — never treat as lxmf.delivery.
  if (isKnownRnsIdentityHash(canonical, activityStore.byDestination)) {
    return resolveIdentityHashToLxmf(canonical, activityStore.byDestination);
  }

  const hasNonLxmfAspect = rows.some(
    (r) => r.aspect !== LXMF_DELIVERY_ASPECT && r.aspect !== 'unknown',
  );
  const identity = identityFromActivity(rows) ?? peerIdentityHint(canonical);

  if (hasNonLxmfAspect || activityHasAspect(rows, LXST_TELEPHONY_ASPECT)) {
    if (identity) {
      const lxmf = findLxmfDeliveryHashForIdentity(identity, activityStore.byDestination);
      if (lxmf) {
        return {
          status: 'ok',
          hash: lxmf,
          remapped: lxmf !== canonical,
        };
      }
    }
    return { status: 'missing_lxmf' };
  }

  // No aspect rows yet — allow (pasted LXMF / path-table peer before announce activity lands).
  if (rows.length === 0) {
    return { status: 'ok', hash: canonical, remapped: false };
  }

  // Only "unknown" placeholders — still try identity remap, else allow.
  if (identity) {
    const lxmf = findLxmfDeliveryHashForIdentity(identity, activityStore.byDestination);
    if (lxmf && lxmf !== canonical) {
      return { status: 'ok', hash: lxmf, remapped: true };
    }
  }
  return { status: 'ok', hash: canonical, remapped: false };
}

/** True when identity activity marks this dest as telephony-only (no lxmf.delivery on the same hash). */
export function isReticulumTelephonyOnlyDestination(candidateHash: string): boolean {
  const canonical = canonicalizeReticulumDestinationHash(candidateHash);
  if (!canonical) return false;
  const rows = useReticulumIdentityActivityStore.getState().getActivity(canonical);
  if (!activityHasAspect(rows, LXST_TELEPHONY_ASPECT)) return false;
  return !activityHasAspect(rows, LXMF_DELIVERY_ASPECT);
}

/**
 * Canonical Chat DM peer node id for filters/unread: LXMF delivery fold when a registry
 * hash resolves, otherwise the original normalized id.
 */
export function canonicalizeReticulumChatDmNodeId(nodeId: number): number {
  const normalized = normalizeReticulumNodeId(nodeId);
  const raw =
    reticulumHashForNodeId(normalized) ?? resolveReticulumDestinationHash(normalized) ?? null;
  if (!raw) return normalized;
  const resolved = resolveReticulumChatLxmfDestination(raw);
  if (resolved.status !== 'ok') return normalized;
  return normalizeReticulumNodeId(reticulumHashToNodeId(resolved.hash));
}

/**
 * Tab-id rewrite for open/active DM migration: only when the bound hash remaps across
 * aspects (e.g. telephony → lxmf.delivery). Sticky non-fold node ids for already-LXMF
 * hashes are preserved so persisted tabs stay stable.
 */
export function remapReticulumChatDmTabNodeId(nodeId: number): number {
  const normalized = normalizeReticulumNodeId(nodeId);
  const raw =
    reticulumHashForNodeId(normalized) ?? resolveReticulumDestinationHash(normalized) ?? null;
  if (!raw) return normalized;
  const resolved = resolveReticulumChatLxmfDestination(raw);
  if (resolved.status !== 'ok' || !resolved.remapped) return normalized;
  return normalizeReticulumNodeId(reticulumHashToNodeId(resolved.hash));
}

/** True when both ids are the same Chat peer after LXMF canonicalization. */
export function reticulumChatDmNodeIdsEquivalent(a: number, b: number): boolean {
  const left = normalizeReticulumNodeId(a);
  const right = normalizeReticulumNodeId(b);
  if (left === right) return true;
  return canonicalizeReticulumChatDmNodeId(left) === canonicalizeReticulumChatDmNodeId(right);
}
