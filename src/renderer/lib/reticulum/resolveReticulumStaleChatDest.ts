/**
 * Detect MeshChatX-era vs mesh-client LXMF mix-ups (e.g. Ceorl-wired vs Ceorl-test):
 * open DM Completes to one lxmf.delivery while another plausible LXMF exists for the same person.
 */

import { classifyReticulumVia } from '@/renderer/lib/reticulum/classifyReticulumVia';
import {
  LXMF_DELIVERY_ASPECT,
  type ResolveReticulumChatLxmfDestResult,
} from '@/renderer/lib/reticulum/resolveReticulumChatLxmfDest';
import type { ReticulumIdentityActivityRow } from '@/renderer/stores/reticulumIdentityActivityStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

export type ReticulumStaleChatDestReason = 'failed_other_lxmf' | 'name_family';

export type ResolveReticulumStaleChatDestResult =
  | { status: 'ok' }
  | {
      status: 'stale_alternate';
      openHash: string;
      alternateHash: string;
      alternateDisplayName: string | null;
      reason: ReticulumStaleChatDestReason;
    };

/** Minimal peer/contact row for display-name + last-seen hints. */
export interface ReticulumStaleChatDestPeerHint {
  destination_hash: string;
  display_name?: string | null;
  custom_display_name?: string | null;
  last_seen?: number | null;
  last_heard?: number | null;
  identity_hash?: string | null;
}

export interface ResolveReticulumStaleChatDestInput {
  openHash: string;
  activityByDestination: ReadonlyMap<string, readonly ReticulumIdentityActivityRow[]>;
  peers: Iterable<ReticulumStaleChatDestPeerHint>;
  /** Normalized destination (or identity) hashes with failed outbound Chat rows. */
  failedOutboundHashes: ReadonlySet<string>;
  /** True when the open dest has at least one delivered outbound Complete. */
  openHasDelivered: boolean;
}

interface LxmfCandidate {
  hash: string;
  identityHash: string | null;
  lastSeen: number;
  displayName: string | null;
  reason: ReticulumStaleChatDestReason;
  rankFailed: boolean;
}

function normalizeHash(hash: string): string {
  return (
    canonicalizeReticulumDestinationHash(hash) ?? hash.replace(/[^0-9a-f]/gi, '').toLowerCase()
  );
}

/** Tokenize a display name for family matching (`Ceorl-wired` → `ceorl`, `wired`). */
export function reticulumDisplayNameFamilyTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True when two display names share a non-trivial token (len ≥ 4) or a leading
 * token prefix (e.g. `ceorl` / `ceorltest`).
 */
export function reticulumDisplayNamesShareFamily(a: string, b: string): boolean {
  const ta = reticulumDisplayNameFamilyTokens(a);
  const tb = reticulumDisplayNameFamilyTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const setB = new Set(tb);
  for (const token of ta) {
    if (token.length >= 4 && setB.has(token)) return true;
  }
  const firstA = ta[0];
  const firstB = tb[0];
  if (!firstA || !firstB) return false;
  const [shorter, longer] = firstA.length <= firstB.length ? [firstA, firstB] : [firstB, firstA];
  return shorter.length >= 4 && longer.startsWith(shorter);
}

function peerLabel(peer: ReticulumStaleChatDestPeerHint): string | null {
  const custom = peer.custom_display_name?.trim();
  if (custom) return custom;
  const wire = peer.display_name?.trim();
  return wire || null;
}

function peerActivityMs(peer: ReticulumStaleChatDestPeerHint): number {
  const heard = peer.last_heard;
  if (typeof heard === 'number' && Number.isFinite(heard) && heard > 0) return heard;
  const seen = peer.last_seen;
  if (typeof seen === 'number' && Number.isFinite(seen) && seen > 0) return seen;
  return 0;
}

function isLxmfDeliveryDest(
  hash: string,
  activityByDestination: ReadonlyMap<string, readonly ReticulumIdentityActivityRow[]>,
): boolean {
  const rows = activityByDestination.get(hash) ?? [];
  return rows.some((r) => r.aspect === LXMF_DELIVERY_ASPECT);
}

function identityForDest(
  hash: string,
  activityByDestination: ReadonlyMap<string, readonly ReticulumIdentityActivityRow[]>,
  peerByHash: ReadonlyMap<string, ReticulumStaleChatDestPeerHint>,
): string | null {
  const rows = activityByDestination.get(hash) ?? [];
  for (const row of rows) {
    const id = row.identity_hash ? canonicalizeReticulumDestinationHash(row.identity_hash) : null;
    if (id) return id;
  }
  const peer = peerByHash.get(hash);
  return peer?.identity_hash ? canonicalizeReticulumDestinationHash(peer.identity_hash) : null;
}

function lastSeenForDest(
  hash: string,
  activityByDestination: ReadonlyMap<string, readonly ReticulumIdentityActivityRow[]>,
  peerByHash: ReadonlyMap<string, ReticulumStaleChatDestPeerHint>,
): number {
  let best = 0;
  for (const row of activityByDestination.get(hash) ?? []) {
    if (row.aspect !== LXMF_DELIVERY_ASPECT) continue;
    if (row.last_seen > best) best = row.last_seen;
  }
  const peer = peerByHash.get(hash);
  if (peer) best = Math.max(best, peerActivityMs(peer));
  return best;
}

function collectLxmfHashes(
  activityByDestination: ReadonlyMap<string, readonly ReticulumIdentityActivityRow[]>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [dest, rows] of activityByDestination) {
    for (const row of rows) {
      if (row.aspect !== LXMF_DELIVERY_ASPECT) continue;
      const hash = normalizeHash(row.destination_hash || dest);
      if (!canonicalizeReticulumDestinationHash(hash) || seen.has(hash)) continue;
      seen.add(hash);
      out.push(hash);
    }
  }
  return out;
}

function displayNameForHash(
  hash: string,
  peerByHash: ReadonlyMap<string, ReticulumStaleChatDestPeerHint>,
  identityHash: string | null,
): string | null {
  const direct = peerByHash.get(hash);
  if (direct) {
    const label = peerLabel(direct);
    if (label) return label;
  }
  if (!identityHash) return null;
  for (const peer of peerByHash.values()) {
    const peerId = peer.identity_hash
      ? canonicalizeReticulumDestinationHash(peer.identity_hash)
      : null;
    if (peerId !== identityHash) continue;
    const label = peerLabel(peer);
    if (label) return label;
  }
  return null;
}

function failedTouchesDest(
  candidateHash: string,
  candidateIdentity: string | null,
  failedOutboundHashes: ReadonlySet<string>,
): boolean {
  if (failedOutboundHashes.has(candidateHash)) return true;
  if (candidateIdentity && failedOutboundHashes.has(candidateIdentity)) return true;
  return false;
}

/**
 * True when the peer’s active path interface is a TCP / transport hub
 * (not RF/BLE or local Auto). Used for Peers list cues.
 */
export function isReticulumPeerHeardViaTcpHub(interfaceName: string | null | undefined): boolean {
  const iface = interfaceName?.trim();
  if (!iface) return false;
  const via = classifyReticulumVia(iface);
  if (via === 'tcp') return true;
  if (via === 'rf' || via === 'ble') return false;
  const lower = iface.toLowerCase();
  return (
    lower.includes('transport') ||
    lower.includes('tcp') ||
    lower.includes('hub') ||
    lower.includes('rathole')
  );
}

/**
 * Detect a plausible alternate LXMF when the open DM may be a stale MeshChatX-era dest.
 */
export function resolveReticulumStaleChatDest(
  input: ResolveReticulumStaleChatDestInput,
): ResolveReticulumStaleChatDestResult {
  const openHash = canonicalizeReticulumDestinationHash(input.openHash);
  if (!openHash) return { status: 'ok' };
  if (!isLxmfDeliveryDest(openHash, input.activityByDestination)) {
    return { status: 'ok' };
  }

  const peerByHash = new Map<string, ReticulumStaleChatDestPeerHint>();
  for (const peer of input.peers) {
    const h = canonicalizeReticulumDestinationHash(peer.destination_hash);
    if (!h) continue;
    peerByHash.set(h, { ...peer, destination_hash: h });
  }

  const openIdentity = identityForDest(openHash, input.activityByDestination, peerByHash);
  const openName = displayNameForHash(openHash, peerByHash, openIdentity);
  const lxmfHashes = collectLxmfHashes(input.activityByDestination);
  const candidates: LxmfCandidate[] = [];

  for (const hash of lxmfHashes) {
    // Destination hashes are public identifiers, not secrets.
    // eslint-disable-next-line security/detect-possible-timing-attacks -- public LXMF dest compare
    if (hash === openHash) continue;
    const identityHash = identityForDest(hash, input.activityByDestination, peerByHash);
    // Same RNS identity → same person already; not a multi-app mix-up.
    if (openIdentity && identityHash && openIdentity === identityHash) continue;

    const displayName = displayNameForHash(hash, peerByHash, identityHash);
    const rankFailed =
      input.openHasDelivered && failedTouchesDest(hash, identityHash, input.failedOutboundHashes);
    const nameFamily =
      openName != null &&
      displayName != null &&
      reticulumDisplayNamesShareFamily(openName, displayName);

    if (!rankFailed && !nameFamily) continue;

    candidates.push({
      hash,
      identityHash,
      lastSeen: lastSeenForDest(hash, input.activityByDestination, peerByHash),
      displayName,
      reason: rankFailed ? 'failed_other_lxmf' : 'name_family',
      rankFailed,
    });
  }

  if (candidates.length === 0) return { status: 'ok' };

  candidates.sort((a, b) => {
    if (a.rankFailed !== b.rankFailed) return a.rankFailed ? -1 : 1;
    if (a.lastSeen !== b.lastSeen) return b.lastSeen - a.lastSeen;
    return a.hash.localeCompare(b.hash);
  });

  const best = candidates[0];
  return {
    status: 'stale_alternate',
    openHash,
    alternateHash: best.hash,
    alternateDisplayName: best.displayName,
    reason: best.reason,
  };
}

/** Convenience: map chat LXMF resolve result through stale detection when send is ok. */
export function staleHintAfterChatLxmfResolve(
  resolved: ResolveReticulumChatLxmfDestResult,
  input: Omit<ResolveReticulumStaleChatDestInput, 'openHash'>,
): ResolveReticulumStaleChatDestResult {
  if (resolved.status !== 'ok') return { status: 'ok' };
  return resolveReticulumStaleChatDest({ ...input, openHash: resolved.hash });
}
