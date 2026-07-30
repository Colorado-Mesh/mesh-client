import { normalizeLastHeardMs } from '@/renderer/lib/nodeStatus';
import type { ReticulumContact, ReticulumPeer } from '@/shared/reticulum-types';

export const RETICULUM_PEER_VIRTUALIZE_THRESHOLD = 100;
export const RETICULUM_PEER_ROW_HEIGHT_PX = 44;

export type ReticulumPeerSortKey = 'name' | 'hops' | 'lastSeen' | 'interface' | 'favorite';
export type ReticulumPeerSortDir = 'asc' | 'desc';

export interface PreparedReticulumPeerRow {
  peer: ReticulumPeer;
  label: string;
  labelLower: string;
  hashLower: string;
  lastActivityMs: number;
  hops: number;
  iface: string;
  favorited: boolean;
}

function peerLastSeenMs(peer: ReticulumPeer): number {
  return normalizeLastHeardMs(peer.last_seen ?? 0);
}

function contactLastHeardMs(contact: ReticulumContact): number {
  return normalizeLastHeardMs(contact.last_heard);
}

export function reticulumPeerLastActivityMs(peer: ReticulumPeer): number {
  const contact = peer as ReticulumContact;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (contact.last_heard != null && contact.last_heard > 0) {
    return contactLastHeardMs(contact);
  }
  return peerLastSeenMs(peer);
}

/**
 * Cheap Peers-tab label: wire/custom name when present, else hash prefix.
 * Full Nomad/contact overlays can be resolved for visible rows only.
 */
export function cheapReticulumPeerLabel(peer: ReticulumPeer): string {
  const custom = peer.custom_display_name?.trim();
  if (custom) return custom;
  const wire = peer.display_name?.trim();
  if (wire) return wire;
  return peer.destination_hash.slice(0, 12);
}

/** One O(n) label/sort-key pass before filter + sort. */
export function prepareReticulumPeerRows(
  peers: readonly ReticulumPeer[],
  labelFor: (peer: ReticulumPeer) => string,
): PreparedReticulumPeerRow[] {
  return peers.map((peer) => {
    const label = labelFor(peer);
    return {
      peer,
      label,
      labelLower: label.toLowerCase(),
      hashLower: peer.destination_hash.toLowerCase(),
      lastActivityMs: reticulumPeerLastActivityMs(peer),
      hops: peer.hops ?? -1,
      iface: peer.interface ?? '',
      favorited: Boolean(peer.favorited),
    };
  });
}

/** Case-insensitive substring match on prepared label or destination hash. */
export function filterPreparedReticulumPeerRows(
  rows: readonly PreparedReticulumPeerRow[],
  query: string,
): PreparedReticulumPeerRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((row) => row.labelLower.includes(q) || row.hashLower.includes(q));
}

function comparePrepared(
  a: PreparedReticulumPeerRow,
  b: PreparedReticulumPeerRow,
  key: ReticulumPeerSortKey,
  dir: ReticulumPeerSortDir,
): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'name':
      return sign * a.label.localeCompare(b.label);
    case 'hops':
      return sign * (a.hops - b.hops);
    case 'lastSeen':
      return sign * (a.lastActivityMs - b.lastActivityMs);
    case 'interface':
      return sign * a.iface.localeCompare(b.iface);
    case 'favorite':
      return sign * (Number(b.favorited) - Number(a.favorited));
    default:
      return 0;
  }
}

/** Favorites first, then the active column. Mutates a copy only. */
export function sortPreparedReticulumPeerRows(
  rows: readonly PreparedReticulumPeerRow[],
  sortKey: ReticulumPeerSortKey,
  sortDir: ReticulumPeerSortDir,
): PreparedReticulumPeerRow[] {
  const next = [...rows];
  next.sort((a, b) => {
    const favDelta = Number(b.favorited) - Number(a.favorited);
    if (favDelta !== 0) return favDelta;
    return comparePrepared(a, b, sortKey, sortDir);
  });
  return next;
}
