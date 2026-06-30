import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import type {
  ReticulumContact,
  ReticulumContactWireRow,
  ReticulumPeer,
  ReticulumPeerWireRow,
} from '@/shared/reticulum-types';

import type { MeshNode } from '../lib/types';
import type { NodeRecord } from './nodeStore';

interface ReticulumDestinationDbRow {
  destination_hash: string;
  display_name?: string | null;
  last_heard?: number | null;
  favorited?: number | null;
}

interface ReticulumPeerStoreState {
  peers: Map<string, ReticulumPeer>;
  contacts: Map<string, ReticulumContact>;
  lastRefreshAt: number | null;
  replacePeers: (peers: ReticulumPeer[]) => void;
  replaceContacts: (contacts: ReticulumContact[]) => void;
  updatePeer: (hash: string, partial: Partial<ReticulumPeer>) => void;
  toggleFavorite: (hash: string, favorited: boolean) => Promise<void>;
  setCustomDisplayName: (hash: string, name: string | null) => Promise<void>;
  getPeer: (hash: string) => ReticulumPeer | ReticulumContact | undefined;
  getDisplayName: (peer: ReticulumPeer) => string;
  isContact: (hash: string) => boolean;
}

function normalizeHash(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function peerDisplayName(peer: ReticulumPeer): string {
  return (
    peer.custom_display_name?.trim() ||
    peer.display_name?.trim() ||
    peer.destination_hash.slice(0, 12)
  );
}

/** Canonical display label for a Reticulum peer/contact row. */
export function reticulumPeerDisplayName(peer: ReticulumPeer): string {
  return peerDisplayName(peer);
}

function overlayDbMeta(
  peer: ReticulumPeer,
  dbByHash: Map<string, ReticulumDestinationDbRow>,
): ReticulumPeer {
  const row = dbByHash.get(normalizeHash(peer.destination_hash));
  if (!row) return peer;
  return {
    ...peer,
    favorited: Boolean(row.favorited),
    custom_display_name: row.display_name?.trim() ? row.display_name : peer.custom_display_name,
    display_name: peer.display_name ?? row.display_name ?? null,
  };
}

function wirePeerToPeer(row: ReticulumPeerWireRow): ReticulumPeer {
  return {
    destination_hash: row.destination_hash,
    display_name: row.display_name ?? null,
    hops: row.hops ?? null,
    last_seen: row.last_seen ?? null,
    interface: row.interface ?? null,
    path_hash: row.path_hash ?? null,
  };
}

function wireContactToContact(
  row: ReticulumContactWireRow,
  hopsByHash: Map<string, number>,
  ifaceByHash: Map<string, string>,
): ReticulumContact {
  const hash = row.destination_hash;
  return {
    destination_hash: hash,
    display_name: row.display_name ?? null,
    last_heard: row.last_heard ?? 0,
    hops: hopsByHash.get(hash) ?? null,
    interface: ifaceByHash.get(hash) ?? null,
    favorited: Boolean(row.favorited),
  };
}

export function mergeReticulumPeerMaps(
  peers: ReticulumPeer[],
  contacts: ReticulumContact[],
  dbRows: ReticulumDestinationDbRow[],
): { peers: Map<string, ReticulumPeer>; contacts: Map<string, ReticulumContact> } {
  const dbByHash = new Map<string, ReticulumDestinationDbRow>();
  for (const row of dbRows) {
    dbByHash.set(normalizeHash(row.destination_hash), row);
  }

  const peerMap = new Map<string, ReticulumPeer>();
  for (const peer of peers) {
    const hash = normalizeHash(peer.destination_hash);
    peerMap.set(hash, overlayDbMeta({ ...peer, destination_hash: hash }, dbByHash));
  }

  const contactMap = new Map<string, ReticulumContact>();
  for (const contact of contacts) {
    const hash = normalizeHash(contact.destination_hash);
    const merged = overlayDbMeta({ ...contact, destination_hash: hash }, dbByHash);
    contactMap.set(hash, { ...merged, last_heard: contact.last_heard });
    peerMap.set(hash, merged);
  }

  return { peers: peerMap, contacts: contactMap };
}

export function reticulumContactToMeshNode(contact: ReticulumContact): MeshNode {
  const nodeId = reticulumHashToNodeId(contact.destination_hash);
  registerReticulumDestinationHash(nodeId, contact.destination_hash);
  const label = peerDisplayName(contact);
  return {
    node_id: nodeId,
    reticulum_destination_hash: contact.destination_hash,
    long_name: label,
    short_name: label.slice(0, 4) || 'RT',
    hw_model: 'Reticulum',
    snr: 0,
    battery: 0,
    last_heard: contact.last_heard,
    latitude: null,
    longitude: null,
    favorited: Boolean(contact.favorited),
    hops_away: contact.hops ?? undefined,
    source: 'rf',
  };
}

export function reticulumContactToNodeRecord(contact: ReticulumContact): NodeRecord {
  const node = reticulumContactToMeshNode(contact);
  return {
    nodeId: node.node_id,
    longName: node.long_name ?? undefined,
    shortName: node.short_name ?? undefined,
    lastHeardAt: node.last_heard ?? undefined,
    hopsAway: node.hops_away,
    favorited: node.favorited,
  };
}

export const useReticulumPeerStore = create<ReticulumPeerStoreState>((set, get) => ({
  peers: new Map(),
  contacts: new Map(),
  lastRefreshAt: null,

  replacePeers: (peers) => {
    set((s) => {
      const next = new Map(s.peers);
      for (const peer of peers) {
        const hash = normalizeHash(peer.destination_hash);
        const existing = next.get(hash);
        next.set(hash, { ...existing, ...peer, destination_hash: hash });
      }
      return { peers: next, lastRefreshAt: Date.now() };
    });
  },

  replaceContacts: (contacts) => {
    set((s) => {
      const contactMap = new Map<string, ReticulumContact>();
      const peerMap = new Map(s.peers);
      for (const contact of contacts) {
        const hash = normalizeHash(contact.destination_hash);
        contactMap.set(hash, { ...contact, destination_hash: hash });
        peerMap.set(hash, { ...peerMap.get(hash), ...contact, destination_hash: hash });
      }
      return { contacts: contactMap, peers: peerMap, lastRefreshAt: Date.now() };
    });
  },

  updatePeer: (hash, partial) => {
    const key = normalizeHash(hash);
    set((s) => {
      const peers = new Map(s.peers);
      const existing = peers.get(key);
      if (!existing) return s;
      peers.set(key, { ...existing, ...partial, destination_hash: key });
      const contacts = new Map(s.contacts);
      const contact = contacts.get(key);
      if (contact) {
        contacts.set(key, { ...contact, ...partial, destination_hash: key });
      }
      return { peers, contacts };
    });
  },

  toggleFavorite: async (hash, favorited) => {
    const key = normalizeHash(hash);
    const peer = get().peers.get(key);
    const previousFavorited = peer?.favorited;
    get().updatePeer(key, { favorited });
    try {
      await window.electronAPI.db.upsertReticulumDestination({
        destination_hash: key,
        display_name: peer?.custom_display_name ?? peer?.display_name ?? null,
        favorited,
      });
    } catch (e) {
      if (previousFavorited !== undefined) {
        get().updatePeer(key, { favorited: previousFavorited });
      } else {
        get().updatePeer(key, { favorited: !favorited });
      }
      console.warn('[reticulumPeerStore] toggleFavorite ' + errLikeToLogString(e));
      throw e;
    }
  },

  setCustomDisplayName: async (hash, name) => {
    const key = normalizeHash(hash);
    const trimmed = name?.trim() || null;
    get().updatePeer(key, { custom_display_name: trimmed });
    const peer = get().peers.get(key);
    try {
      await window.electronAPI.db.upsertReticulumDestination({
        destination_hash: key,
        display_name: trimmed,
        favorited: peer?.favorited ?? false,
        last_heard:
          'last_heard' in (peer ?? {}) ? (peer as ReticulumContact).last_heard : undefined,
      });
    } catch (e) {
      console.warn('[reticulumPeerStore] setCustomDisplayName ' + errLikeToLogString(e));
    }
  },

  getPeer: (hash) => {
    const key = normalizeHash(hash);
    return get().contacts.get(key) ?? get().peers.get(key);
  },

  getDisplayName: (peer) => peerDisplayName(peer),

  isContact: (hash) => get().contacts.has(normalizeHash(hash)),
}));

export const RETICULUM_PEER_REFRESH_MS = 30_000;

/** Fetch sidecar peers/contacts, overlay SQLite meta, update store; returns contacts for nodeStore sync. */
export async function refreshReticulumPeersFromSidecar(): Promise<ReticulumContact[]> {
  try {
    const [contactsBody, peersBody, dbRows] = await Promise.all([
      window.electronAPI.reticulum.proxyGet('/api/v1/contacts') as Promise<{
        contacts?: ReticulumContactWireRow[];
      }>,
      window.electronAPI.reticulum.proxyGet('/api/v1/peers') as Promise<{
        peers?: ReticulumPeerWireRow[];
      }>,
      window.electronAPI.db.getReticulumDestinations() as Promise<ReticulumDestinationDbRow[]>,
    ]);

    const hopsByHash = new Map<string, number>();
    const ifaceByHash = new Map<string, string>();
    for (const peer of peersBody.peers ?? []) {
      const hash = normalizeHash(peer.destination_hash);
      if (peer.hops != null) hopsByHash.set(hash, peer.hops);
      if (peer.interface) ifaceByHash.set(hash, peer.interface);
    }

    const wirePeers = (peersBody.peers ?? []).map(wirePeerToPeer);
    const wireContacts = (contactsBody.contacts ?? []).map((row) =>
      wireContactToContact(row, hopsByHash, ifaceByHash),
    );

    const { peers, contacts } = mergeReticulumPeerMaps(wirePeers, wireContacts, dbRows ?? []);

    useReticulumPeerStore.setState({
      peers,
      contacts,
      lastRefreshAt: Date.now(),
    });

    return [...contacts.values()];
  } catch (e) {
    console.warn('[reticulumPeerStore] refresh ' + errLikeToLogString(e));
    return [];
  }
}
