import { create } from 'zustand';

import { getIdentityIdForProtocol } from '@/renderer/lib/identityByProtocol';
import { getOfflineIdentityIdForProtocol } from '@/renderer/lib/offlineProtocolIdentities';
import {
  registerReticulumDestinationHash,
  resolveReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { useNodeStore } from '@/renderer/stores/nodeStore';
import { omitRecordKey } from '@/renderer/stores/storeUtils';
import type {
  ReticulumContact,
  ReticulumContactWireRow,
  ReticulumPeer,
  ReticulumPeerWireRow,
} from '@/shared/reticulum-types';

import { errLikeToLogString } from '../lib/errLikeToLogString';
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
  dismissedContactHashes: Set<string>;
  replacePeers: (peers: ReticulumPeer[]) => void;
  replaceContacts: (contacts: ReticulumContact[]) => void;
  updatePeer: (hash: string, partial: Partial<ReticulumPeer>) => void;
  toggleFavorite: (hash: string, favorited: boolean) => Promise<void>;
  setCustomDisplayName: (hash: string, name: string | null) => Promise<void>;
  removeContact: (hash: string, identityId?: string | null) => Promise<void>;
  restoreDismissedContact: (hash: string) => void;
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

/** Prefer wire/LXMF names from node store when path-table peers only have hashes. */
export function resolveReticulumPeerLabel(
  peer: ReticulumPeer,
  nodeLongName?: string | null,
  nomadDisplayName?: string | null,
): string {
  const label = peerDisplayName(peer);
  const hashSlice = peer.destination_hash.slice(0, 12);
  if (label !== hashSlice) return label;
  const wire = nodeLongName?.trim();
  if (wire && wire !== hashSlice) return wire;
  const nomad = nomadDisplayName?.trim();
  if (nomad && nomad !== hashSlice) return nomad;
  return label;
}

const DISMISSED_CONTACTS_STORAGE_KEY = 'mesh-client:reticulumDismissedContacts';

function loadDismissedContactHashes(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_CONTACTS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((h): h is string => typeof h === 'string').map(normalizeHash));
  } catch {
    // catch-no-log-ok localStorage JSON parse failure — start with empty dismissed set
    return new Set();
  }
}

function persistDismissedContactHashes(hashes: Set<string>): void {
  localStorage.setItem(DISMISSED_CONTACTS_STORAGE_KEY, JSON.stringify([...hashes]));
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
    via_hash: row.via_hash ?? null,
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
  dismissedContactHashes: ReadonlySet<string> = new Set(),
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
    if (dismissedContactHashes.has(hash)) continue;
    const merged = overlayDbMeta({ ...contact, destination_hash: hash }, dbByHash);
    contactMap.set(hash, { ...merged, last_heard: contact.last_heard });
    peerMap.set(hash, merged);
  }

  for (const [hash, row] of dbByHash) {
    if (dismissedContactHashes.has(hash)) continue;
    if (contactMap.has(hash)) continue;
    const fromPeer = peerMap.get(hash);
    const saved: ReticulumContact = {
      destination_hash: hash,
      display_name: row.display_name ?? fromPeer?.display_name ?? null,
      last_heard: row.last_heard ?? fromPeer?.last_seen ?? 0,
      hops: fromPeer?.hops ?? null,
      interface: fromPeer?.interface ?? null,
      favorited: Boolean(row.favorited),
    };
    contactMap.set(hash, saved);
    if (!peerMap.has(hash)) {
      peerMap.set(hash, saved);
    }
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
    reticulumDestinationHash: contact.destination_hash,
  };
}

export const useReticulumPeerStore = create<ReticulumPeerStoreState>((set, get) => ({
  peers: new Map(),
  contacts: new Map(),
  lastRefreshAt: null,
  dismissedContactHashes: loadDismissedContactHashes(),

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

  removeContact: async (hash, identityId) => {
    const key = normalizeHash(hash);
    const dismissed = new Set(get().dismissedContactHashes);
    dismissed.add(key);
    persistDismissedContactHashes(dismissed);
    set((s) => {
      const contacts = new Map(s.contacts);
      contacts.delete(key);
      return { contacts, dismissedContactHashes: dismissed };
    });
    try {
      await window.electronAPI.db.deleteReticulumDestination(key);
    } catch (e) {
      console.warn('[reticulumPeerStore] removeContact db ' + errLikeToLogString(e));
    }
    const resolvedIdentityId =
      identityId ??
      getIdentityIdForProtocol('reticulum') ??
      getOfflineIdentityIdForProtocol('reticulum');
    if (resolvedIdentityId) {
      const nodeId = reticulumHashToNodeId(key);
      useNodeStore.setState((s) => {
        const byIdentity = s.nodes[resolvedIdentityId];
        if (!byIdentity?.[nodeId]) return s;
        return {
          nodes: {
            ...s.nodes,
            [resolvedIdentityId]: omitRecordKey(byIdentity, String(nodeId)),
          },
        };
      });
    }
  },

  restoreDismissedContact: (hash) => {
    const key = normalizeHash(hash);
    const dismissed = new Set(get().dismissedContactHashes);
    if (!dismissed.has(key)) return;
    dismissed.delete(key);
    persistDismissedContactHashes(dismissed);
    set({ dismissedContactHashes: dismissed });
  },

  getPeer: (hash) => {
    const key = normalizeHash(hash);
    return get().contacts.get(key) ?? get().peers.get(key);
  },

  getDisplayName: (peer) => peerDisplayName(peer),

  isContact: (hash) => get().contacts.has(normalizeHash(hash)),
}));

/** Resolve LXMF destination hash for a numeric node id (registry, node store, peer/contact store). */
export function reticulumHashForNodeId(nodeId: number): string | null {
  const registered = resolveReticulumDestinationHash(nodeId);
  if (registered) return registered;
  const identityId =
    getIdentityIdForProtocol('reticulum') ?? getOfflineIdentityIdForProtocol('reticulum');
  const nodeRecord = useNodeStore.getState().nodes[identityId]?.[nodeId];
  if (nodeRecord?.reticulumDestinationHash) {
    registerReticulumDestinationHash(nodeId, nodeRecord.reticulumDestinationHash);
    return nodeRecord.reticulumDestinationHash;
  }
  const { peers, contacts } = useReticulumPeerStore.getState();
  for (const row of [...peers.values(), ...contacts.values()]) {
    const hash = row.destination_hash;
    if (reticulumHashToNodeId(hash) === nodeId) {
      registerReticulumDestinationHash(nodeId, hash);
      return hash;
    }
  }
  return null;
}

export const RETICULUM_PEER_REFRESH_MS = 30_000;

/** Fetch sidecar peers/contacts, overlay SQLite + nomad announce names, update store. */
export async function refreshReticulumPeersFromSidecar(): Promise<ReticulumContact[]> {
  try {
    const [contactsBody, peersBody, dbRows, nomadBody] = await Promise.all([
      window.electronAPI.reticulum.proxyGet('/api/v1/contacts') as Promise<{
        contacts?: ReticulumContactWireRow[];
      }>,
      window.electronAPI.reticulum.proxyGet('/api/v1/peers') as Promise<{
        peers?: ReticulumPeerWireRow[];
      }>,
      window.electronAPI.db.getReticulumDestinations() as Promise<ReticulumDestinationDbRow[]>,
      window.electronAPI.reticulum.proxyGet('/api/v1/nomadnetwork/nodes') as Promise<{
        nodes?: { destination_hash: string; display_name?: string | null }[];
      }>,
    ]);

    const nomadNameByHash = new Map<string, string>();
    for (const node of nomadBody.nodes ?? []) {
      const name = node.display_name?.trim();
      if (!name) continue;
      nomadNameByHash.set(normalizeHash(node.destination_hash), name);
    }

    const hopsByHash = new Map<string, number>();
    const ifaceByHash = new Map<string, string>();
    for (const peer of peersBody.peers ?? []) {
      const hash = normalizeHash(peer.destination_hash);
      if (peer.hops != null) hopsByHash.set(hash, peer.hops);
      if (peer.interface) ifaceByHash.set(hash, peer.interface);
    }

    const wirePeers = (peersBody.peers ?? []).map((row) => {
      const peer = wirePeerToPeer(row);
      const hash = normalizeHash(peer.destination_hash);
      if (peer.display_name?.trim()) return peer;
      const nomadName = nomadNameByHash.get(hash);
      return nomadName ? { ...peer, display_name: nomadName } : peer;
    });
    const wireContacts = (contactsBody.contacts ?? []).map((row) =>
      wireContactToContact(row, hopsByHash, ifaceByHash),
    );

    const dismissed = useReticulumPeerStore.getState().dismissedContactHashes;
    const { peers, contacts } = mergeReticulumPeerMaps(
      wirePeers,
      wireContacts,
      dbRows ?? [],
      dismissed,
    );

    useReticulumPeerStore.setState({
      peers,
      contacts,
      lastRefreshAt: Date.now(),
    });

    for (const peer of peers.values()) {
      registerReticulumDestinationHash(
        reticulumHashToNodeId(peer.destination_hash),
        peer.destination_hash,
      );
    }

    return [...contacts.values()];
  } catch (e) {
    console.warn('[reticulumPeerStore] refresh ' + errLikeToLogString(e));
    return [];
  }
}
