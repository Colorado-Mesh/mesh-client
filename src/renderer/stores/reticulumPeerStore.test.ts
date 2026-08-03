import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReticulumContact } from '@/shared/reticulum-types';

import { reticulumHashToNodeId } from '../lib/reticulum/destHash';
import {
  applyReticulumAnnounceReceivedOptimistic,
  applyReticulumPeerPatchesNow,
  applyReticulumPeersUpdatedPatches,
  capReticulumPeerMaps,
  mergePeerAppearancesFromDb,
  mergeReticulumPeerMaps,
  refreshReticulumPeersFromSidecar,
  resetReticulumPeerPatchBufferForTests,
  resetReticulumPeerRefreshSingleFlightForTests,
  resolveReticulumPeerLabel,
  reticulumContactToNodeRecordPreservingLabel,
  reticulumHashForNodeId,
  reticulumPeerDisplayName,
  useReticulumPeerStore,
} from './reticulumPeerStore';

describe('resolveReticulumPeerLabel', () => {
  const hash = 'aa'.repeat(16);

  it('uses peer display_name when present', () => {
    expect(
      resolveReticulumPeerLabel({
        destination_hash: hash,
        display_name: 'Alice',
      }),
    ).toBe('Alice');
  });

  it('extracts server_name from JSON display_name blobs', () => {
    expect(
      resolveReticulumPeerLabel({
        destination_hash: hash,
        display_name: '{"server_name": "Chicago Offline BBS"}',
      }),
    ).toBe('Chicago Offline BBS');
  });

  it('falls back to hash prefix for RMAP geo JSON blobs', () => {
    expect(
      resolveReticulumPeerLabel({
        destination_hash: hash,
        display_name: '{"h":"5440f5d4485a00fb8441ad94fbdee46e","ha":"0","c":"1"}',
      }),
    ).toBe(hash.slice(0, 12));
  });

  it('falls back to nomad name when peer row is hash-only', () => {
    expect(
      resolveReticulumPeerLabel({ destination_hash: hash, display_name: null }, null, 'Nomad Node'),
    ).toBe('Nomad Node');
  });
});

describe('capReticulumPeerMaps', () => {
  it('caps path-table peers but retains Contacts/History rows', () => {
    const peers = new Map([
      ['old', { destination_hash: 'old', last_seen: 1 }],
      ['mid', { destination_hash: 'mid', last_seen: 50 }],
      ['new', { destination_hash: 'new', last_seen: 100 }],
    ]);
    const contacts = new Map([
      ['old', { destination_hash: 'old', last_heard: 1 }],
      ['mid', { destination_hash: 'mid', last_heard: 50 }],
      ['orphan', { destination_hash: 'orphan', last_heard: 200 }],
    ]);
    const history = new Map([['hist-only', { destination_hash: 'hist-only', last_heard: 300 }]]);
    const {
      peers: cappedPeers,
      contacts: cappedContacts,
      history: cappedHistory,
    } = capReticulumPeerMaps(peers, contacts, history, 2);
    expect(cappedPeers.has('new')).toBe(true);
    expect(cappedPeers.has('mid')).toBe(true);
    // Contacts/History survive path-table eviction and get peer stubs.
    expect(cappedContacts.has('orphan')).toBe(true);
    expect(cappedPeers.has('orphan')).toBe(true);
    expect(cappedHistory.has('hist-only')).toBe(true);
    expect(cappedPeers.has('hist-only')).toBe(true);
  });
});

describe('mergeReticulumPeerMaps', () => {
  it('merges peers and contacts with SQLite overlay', () => {
    const { peers, contacts, history } = mergeReticulumPeerMaps(
      [
        {
          destination_hash: 'abc123',
          display_name: 'Peer A',
          hops: 2,
        },
      ],
      [
        {
          destination_hash: 'def456',
          display_name: 'Contact B',
          last_heard: 1000,
          hops: 1,
        },
      ],
      [
        {
          destination_hash: 'abc123',
          display_name: 'Custom A',
          favorited: 1,
        },
      ],
    );

    expect(peers.get('abc123')?.favorited).toBe(true);
    expect(peers.get('abc123')?.custom_display_name).toBe('Custom A');
    expect(contacts.has('abc123')).toBe(false);
    // Wire LXMF contacts alone are History hints — Contacts require SQLite is_contact.
    expect(contacts.has('def456')).toBe(false);
    expect(history.get('def456')?.last_heard).toBe(1000);
    expect(peers.has('def456')).toBe(true);
  });

  it('does not promote favorited path peers without last_heard into contacts', () => {
    const { peers, contacts, history } = mergeReticulumPeerMaps(
      [
        {
          destination_hash: 'aabb01',
          display_name: 'Path Peer',
          hops: 1,
        },
      ],
      [],
      [
        {
          destination_hash: 'aabb01',
          display_name: 'Renamed Peer',
          favorited: 1,
        },
      ],
    );

    expect(peers.get('aabb01')?.favorited).toBe(true);
    expect(peers.get('aabb01')?.custom_display_name).toBe('Renamed Peer');
    expect(contacts.has('aabb01')).toBe(false);
    expect(history.has('aabb01')).toBe(false);
  });

  it('promotes SQLite last_heard into History without is_contact', () => {
    const { peers, contacts, history } = mergeReticulumPeerMaps(
      [
        {
          destination_hash: 'aabb02',
          display_name: 'Announce Name',
          hops: 3,
        },
      ],
      [],
      [
        {
          destination_hash: 'aabb02',
          display_name: 'Messaged Label',
          last_heard: 1_700_000_000,
          favorited: 0,
        },
      ],
    );

    expect(contacts.has('aabb02')).toBe(false);
    expect(history.get('aabb02')?.last_heard).toBe(1_700_000_000);
    expect(history.get('aabb02')?.custom_display_name).toBe('Messaged Label');
    expect(history.get('aabb02')?.hops).toBe(3);
    expect(peers.has('aabb02')).toBe(true);
  });

  it('promotes SQLite is_contact into Contacts (Save Contact)', () => {
    const { peers, contacts, history } = mergeReticulumPeerMaps(
      [
        {
          destination_hash: 'aabb02',
          display_name: 'Announce Name',
          hops: 3,
        },
      ],
      [],
      [
        {
          destination_hash: 'aabb02',
          display_name: 'Saved Label',
          last_heard: 1_700_000_000,
          is_contact: 1,
          favorited: 0,
        },
      ],
    );

    expect(contacts.get('aabb02')?.last_heard).toBe(1_700_000_000);
    expect(contacts.get('aabb02')?.is_contact).toBe(true);
    expect(contacts.get('aabb02')?.custom_display_name).toBe('Saved Label');
    expect(history.get('aabb02')?.last_heard).toBe(1_700_000_000);
    expect(peers.has('aabb02')).toBe(true);
  });

  it('promotes DB-only last_heard rows into History when peer is absent', () => {
    const { peers, contacts, history } = mergeReticulumPeerMaps(
      [],
      [],
      [
        {
          destination_hash: 'aabb03',
          display_name: 'Offline History',
          last_heard: 1_700_000_100,
          favorited: 1,
        },
      ],
    );

    expect(contacts.has('aabb03')).toBe(false);
    expect(history.get('aabb03')?.last_heard).toBe(1_700_000_100);
    expect(history.get('aabb03')?.favorited).toBe(true);
    expect(peers.has('aabb03')).toBe(true);
  });

  it('keeps DB-only favorite/appearance rows on peers without promoting to contacts', () => {
    const { peers, contacts } = mergeReticulumPeerMaps(
      [],
      [],
      [
        {
          destination_hash: 'aabb04',
          display_name: 'Starred',
          favorited: 1,
        },
      ],
    );

    expect(peers.get('aabb04')?.favorited).toBe(true);
    expect(peers.get('aabb04')?.custom_display_name).toBe('Starred');
    expect(contacts.has('aabb04')).toBe(false);
  });

  it('reflects wire fields on peers/history; SQLite is_contact promotes Contacts', () => {
    const { peers, contacts, history } = mergeReticulumPeerMaps(
      [],
      [
        {
          destination_hash: 'def456',
          display_name: 'Contact B',
          last_heard: 1000,
          hops: 1,
        },
      ],
      [
        {
          destination_hash: 'def456',
          display_name: 'Saved Contact',
          favorited: 1,
          is_contact: 1,
          last_heard: 1000,
        },
      ],
    );

    const contact = contacts.get('def456');
    expect(contact?.last_heard).toBe(1000);
    expect(contact?.hops).toBe(1);
    expect(contact?.favorited).toBe(true);
    expect(contact?.custom_display_name).toBe('Saved Contact');
    expect(history.get('def456')?.last_heard).toBe(1000);

    const peer = peers.get('def456') as ReticulumContact | undefined;
    expect(peer?.last_heard).toBe(1000);
    expect(peer?.hops).toBe(1);
    expect(peer?.favorited).toBe(true);
    expect(peer?.custom_display_name).toBe('Saved Contact');
    expect(peer?.display_name).toBe('Contact B');
  });

  it('does not promote sidecar wire contacts into Contacts without SQLite is_contact', () => {
    const hash = 'ee'.repeat(16);
    const { contacts, history } = mergeReticulumPeerMaps(
      [],
      [
        {
          destination_hash: hash,
          display_name: 'Legacy Wire',
          last_heard: 2000,
          hops: 1,
        },
      ],
      [],
    );
    expect(contacts.has(hash)).toBe(false);
    expect(history.get(hash)?.last_heard).toBe(2000);
  });

  it('preserves peer announce alias when nameless wire contact overlays the peer row', () => {
    const hash = 'aabbccddeeff00112233445566778899';
    const { peers, contacts, history } = mergeReticulumPeerMaps(
      [
        {
          destination_hash: hash,
          display_name: 'Hub Peer',
          hops: 2,
          interface: 'tcp',
        },
      ],
      [
        {
          destination_hash: hash,
          display_name: null,
          last_heard: 1_700_000_000,
          hops: 1,
        },
      ],
      [],
    );

    expect(contacts.has(hash)).toBe(false);
    expect(history.get(hash)?.display_name).toBe('Hub Peer');
    expect(history.get(hash)?.hops).toBe(1);
    expect(history.get(hash)?.last_heard).toBe(1_700_000_000);
    expect(peers.get(hash)?.display_name).toBe('Hub Peer');
    expect(peers.get(hash)?.hops).toBe(1);
  });

  it('does not let hash-prefix wire alias wipe peer announce name', () => {
    const hash = 'deadbeefcafebabe0123456789abcdef';
    const { peers, contacts, history } = mergeReticulumPeerMaps(
      [{ destination_hash: hash, display_name: 'Real Alias', hops: 3 }],
      [
        {
          destination_hash: hash,
          display_name: 'deadbeefcafe',
          last_heard: 100,
          hops: 3,
        },
      ],
      [],
    );

    expect(contacts.has(hash)).toBe(false);
    expect(history.get(hash)?.display_name).toBe('Real Alias');
    expect(peers.get(hash)?.display_name).toBe('Real Alias');
  });
});

describe('reticulumPeerStore', () => {
  beforeEach(() => {
    resetReticulumPeerRefreshSingleFlightForTests();
    resetReticulumPeerPatchBufferForTests();
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map(),
      history: new Map(),
      dismissedContactHashes: new Set(),
      peerAppearanceByHash: new Map(),
      lastRefreshAt: null,
      peersRevision: 0,
    });
    vi.restoreAllMocks();
  });

  it('applies peers_updated patches without a full Map replacePeers path', () => {
    applyReticulumPeersUpdatedPatches({
      added: ['aa'.repeat(16)],
      patches: [
        {
          destination_hash: 'aa'.repeat(16),
          display_name: 'Patched',
          hops: 2,
          last_seen: 42,
        },
      ],
      count: 1,
    });
    applyReticulumPeerPatchesNow([]);
    const peer = useReticulumPeerStore.getState().peers.get('aa'.repeat(16));
    expect(peer?.display_name).toBe('Patched');
    expect(peer?.hops).toBe(2);
  });

  it('batches announce optimistic updates via patch buffer', () => {
    vi.useFakeTimers();
    applyReticulumAnnounceReceivedOptimistic({
      destination_hash: 'bb'.repeat(16),
      display_name: 'Announced',
      hops: 1,
    });
    expect(useReticulumPeerStore.getState().peers.size).toBe(0);
    vi.advanceTimersByTime(50);
    expect(useReticulumPeerStore.getState().peers.get('bb'.repeat(16))?.display_name).toBe(
      'Announced',
    );
    vi.useRealTimers();
  });

  it('toggleFavorite persists to SQLite', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      electronAPI: {
        db: { upsertReticulumDestination: upsert },
      },
    });

    useReticulumPeerStore
      .getState()
      .replacePeers([{ destination_hash: 'deadbeef', display_name: 'Test' }]);

    await useReticulumPeerStore.getState().toggleFavorite('deadbeef', true);

    expect(useReticulumPeerStore.getState().peers.get('deadbeef')?.favorited).toBe(true);
    expect(upsert).toHaveBeenCalledWith({
      destination_hash: 'deadbeef',
      display_name: 'Test',
      favorited: true,
    });
  });

  it('isContact returns true only for LXMF contacts map', () => {
    useReticulumPeerStore.getState().replacePeers([{ destination_hash: 'peeronly' }]);
    useReticulumPeerStore
      .getState()
      .replaceContacts([{ destination_hash: 'contact1', last_heard: 100 }]);

    expect(useReticulumPeerStore.getState().isContact('contact1')).toBe(true);
    expect(useReticulumPeerStore.getState().isContact('peeronly')).toBe(false);
    expect(useReticulumPeerStore.getState().isContact('CONTACT1')).toBe(true);
    expect(useReticulumPeerStore.getState().isContact('NONEXISTENT')).toBe(false);
  });

  it('removeContact demotes Contacts, keeps History, and dismisses re-import', async () => {
    const hash = 'aa'.repeat(16);
    const upsert = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      electronAPI: {
        db: { upsertReticulumDestination: upsert },
      },
    });
    useReticulumPeerStore.setState({
      contacts: new Map([
        [hash, { destination_hash: hash, last_heard: 50, display_name: 'Saved', is_contact: true }],
      ]),
      history: new Map([[hash, { destination_hash: hash, last_heard: 50, display_name: 'Saved' }]]),
      dismissedContactHashes: new Set(),
    });

    await useReticulumPeerStore.getState().removeContact(hash);

    expect(useReticulumPeerStore.getState().contacts.has(hash)).toBe(false);
    expect(useReticulumPeerStore.getState().history.get(hash)?.last_heard).toBe(50);
    expect(useReticulumPeerStore.getState().dismissedContactHashes.has(hash)).toBe(true);
    expect(upsert).toHaveBeenCalledWith({ destination_hash: hash, is_contact: false });

    const { contacts, history } = mergeReticulumPeerMaps(
      [],
      [{ destination_hash: hash, last_heard: 50, display_name: 'Wire' }],
      [{ destination_hash: hash, last_heard: 50, is_contact: 1 }],
      useReticulumPeerStore.getState().dismissedContactHashes,
    );
    expect(contacts.has(hash)).toBe(false);
    expect(history.get(hash)?.last_heard).toBe(50);
  });

  it('stampHistoryPeer updates history and reticulumHashForNodeId finds history-only peers', () => {
    const hash = 'bb'.repeat(16);
    useReticulumPeerStore.getState().stampHistoryPeer(hash, {
      last_heard: 123,
      display_name: 'HistPeer',
    });
    expect(useReticulumPeerStore.getState().history.get(hash)?.last_heard).toBe(123);
    expect(useReticulumPeerStore.getState().contacts.has(hash)).toBe(false);
    const nodeId = reticulumHashToNodeId(hash);
    expect(reticulumHashForNodeId(nodeId)).toBe(hash);
  });

  it('getPeer normalizes hash case like isContact', () => {
    useReticulumPeerStore
      .getState()
      .replacePeers([{ destination_hash: 'abc123', display_name: 'Peer A', hops: 2 }]);
    useReticulumPeerStore
      .getState()
      .replaceContacts([{ destination_hash: 'contact1', last_heard: 100, display_name: 'LXMF' }]);

    expect(useReticulumPeerStore.getState().getPeer('ABC123')?.display_name).toBe('Peer A');
    expect(useReticulumPeerStore.getState().getPeer('CONTACT1')?.display_name).toBe('LXMF');
    const contactPeer = useReticulumPeerStore.getState().getPeer('contact1') as
      ReticulumContact | undefined;
    expect(contactPeer?.last_heard).toBe(100);
    expect(useReticulumPeerStore.getState().getPeer('missing')).toBeUndefined();
  });

  it('getPeer overlays live peer route fields onto a saved contact', () => {
    const hash = 'aa'.repeat(16);
    useReticulumPeerStore.setState({
      peers: new Map([
        [
          hash,
          {
            destination_hash: hash,
            hops: 2,
            interface: 'RMAP World',
            path_hash: 'bb'.repeat(16),
            via_hash: 'bb'.repeat(16),
          },
        ],
      ]),
      contacts: new Map([
        [
          hash,
          {
            destination_hash: hash,
            display_name: 'Saved',
            last_heard: 100,
            is_contact: true,
            hops: null,
            interface: null,
          },
        ],
      ]),
      history: new Map(),
    });
    const peer = useReticulumPeerStore.getState().getPeer(hash);
    expect(peer?.display_name).toBe('Saved');
    expect(peer?.hops).toBe(2);
    expect(peer?.interface).toBe('RMAP World');
    expect(peer?.path_hash).toBe('bb'.repeat(16));
  });

  it('updatePeer seeds peers from contact-only rows', () => {
    const hash = 'cc'.repeat(16);
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map([
        [
          hash,
          {
            destination_hash: hash,
            display_name: 'ContactOnly',
            last_heard: 50,
            is_contact: true,
          },
        ],
      ]),
      history: new Map(),
    });
    useReticulumPeerStore.getState().updatePeer(hash, { hops: 3, interface: 'tcp' });
    expect(useReticulumPeerStore.getState().peers.get(hash)?.hops).toBe(3);
    expect(useReticulumPeerStore.getState().contacts.get(hash)?.hops).toBe(3);
    expect(useReticulumPeerStore.getState().contacts.get(hash)?.interface).toBe('tcp');
  });

  it('peer patches flush route fields onto matching contacts', () => {
    vi.useFakeTimers();
    const hash = 'dd'.repeat(16);
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map([
        [
          hash,
          {
            destination_hash: hash,
            display_name: 'Patched',
            last_heard: 1,
            is_contact: true,
          },
        ],
      ]),
      history: new Map(),
      peersRevision: 0,
    });
    applyReticulumPeersUpdatedPatches({
      patches: [
        {
          destination_hash: hash,
          hops: 4,
          interface: 'Aurora',
          path_hash: 'ee'.repeat(16),
          via_hash: 'ee'.repeat(16),
          last_seen: 99,
        },
      ],
    });
    applyReticulumPeerPatchesNow([]);
    expect(useReticulumPeerStore.getState().contacts.get(hash)?.hops).toBe(4);
    expect(useReticulumPeerStore.getState().contacts.get(hash)?.interface).toBe('Aurora');
    expect(useReticulumPeerStore.getState().contacts.get(hash)?.via_hash).toBe('ee'.repeat(16));
    expect(useReticulumPeerStore.getState().getPeer(hash)?.path_hash).toBe('ee'.repeat(16));
    vi.useRealTimers();
  });

  it('applyReticulumPeerActivePathSlot updates contact route from paths result', async () => {
    const { applyReticulumPeerActivePathSlot } = await import('./reticulumPeerStore');
    const hash = 'ff'.repeat(16);
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map([
        [
          hash,
          {
            destination_hash: hash,
            display_name: 'SlotPeer',
            last_heard: 1,
            is_contact: true,
          },
        ],
      ]),
      history: new Map(),
    });
    const applied = applyReticulumPeerActivePathSlot(hash, {
      ok: true,
      paths: [
        {
          active: true,
          expired: false,
          hops: 2,
          via_hash: '11'.repeat(16),
          interface: 'RMAP World',
          timestamp: 1234,
        },
      ],
    });
    expect(applied).toBe(true);
    expect(useReticulumPeerStore.getState().getPeer(hash)).toMatchObject({
      hops: 2,
      interface: 'RMAP World',
      path_hash: '11'.repeat(16),
      via_hash: '11'.repeat(16),
    });
  });

  it('clearPeers empties peers, contacts, and history', () => {
    useReticulumPeerStore.getState().replacePeers([{ destination_hash: 'aa' }]);
    useReticulumPeerStore.getState().replaceContacts([{ destination_hash: 'bb', last_heard: 1 }]);
    useReticulumPeerStore.getState().stampHistoryPeer('cc'.repeat(16), {
      last_heard: 99,
      display_name: 'Hist',
    });
    useReticulumPeerStore.getState().clearPeers();
    expect(useReticulumPeerStore.getState().peers.size).toBe(0);
    expect(useReticulumPeerStore.getState().contacts.size).toBe(0);
    expect(useReticulumPeerStore.getState().history.size).toBe(0);
  });

  it('clearAllContacts clears sidecar, SQLite contact rows, and store contacts', async () => {
    const proxyDelete = vi.fn().mockResolvedValue({ ok: true, cleared: 3 });
    const clearDb = vi.fn().mockResolvedValue({ changes: 2 });
    const proxyGet = vi.fn((path: string) => {
      if (path === '/api/v1/contacts') return Promise.resolve({ contacts: [] });
      if (path === '/api/v1/peers') {
        return Promise.resolve({
          peers: [
            { destination_hash: 'aabb01', hops: 1 },
            { destination_hash: 'ccdd02', display_name: 'Demoted', last_seen: 9 },
          ],
        });
      }
      return Promise.resolve({});
    });
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: { proxyDelete, proxyGet },
        db: {
          clearReticulumContactDestinations: clearDb,
          getReticulumDestinations: vi.fn().mockResolvedValue([]),
        },
      },
    });

    useReticulumPeerStore.getState().replacePeers([{ destination_hash: 'aabb01', hops: 1 }]);
    useReticulumPeerStore
      .getState()
      .replaceContacts([{ destination_hash: 'ccdd02', last_heard: 9, display_name: 'Demoted' }]);

    const result = await useReticulumPeerStore.getState().clearAllContacts();

    expect(proxyDelete).toHaveBeenCalledWith('/api/v1/contacts');
    expect(clearDb).toHaveBeenCalled();
    expect(result).toEqual({ clearedSidecar: 3, clearedDb: 2 });
    expect(useReticulumPeerStore.getState().contacts.size).toBe(0);
    expect(useReticulumPeerStore.getState().peers.has('aabb01')).toBe(true);
    expect(useReticulumPeerStore.getState().peers.get('ccdd02')?.display_name).toBe('Demoted');
  });

  it('clearAllContacts leaves contacts in UI when sidecar clear fails', async () => {
    const proxyDelete = vi.fn().mockRejectedValue(new Error('sidecar down'));
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: { proxyDelete },
        db: { clearReticulumContactDestinations: vi.fn() },
      },
    });
    useReticulumPeerStore
      .getState()
      .replaceContacts([{ destination_hash: 'aabb01', last_heard: 1, display_name: 'Keep' }]);

    await expect(useReticulumPeerStore.getState().clearAllContacts()).rejects.toThrow(
      'sidecar down',
    );
    expect(useReticulumPeerStore.getState().contacts.get('aabb01')?.display_name).toBe('Keep');
    expect(window.electronAPI.db.clearReticulumContactDestinations).not.toHaveBeenCalled();
  });

  it('refreshReticulumPeersFromSidecar coalesces overlapping calls and applies latest', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    const proxyGet = vi.fn(async (path: string) => {
      if (path === '/api/v1/contacts') {
        call += 1;
        const n = call;
        if (n === 1) await firstGate;
        return {
          contacts: [
            {
              destination_hash: 'aa',
              last_heard: n === 1 ? 1 : 99,
              display_name: n === 1 ? 'Stale' : 'Fresh',
            },
          ],
        };
      }
      if (path === '/api/v1/peers') {
        return Promise.resolve({ peers: [{ destination_hash: 'aa', hops: 1 }] });
      }
      if (path === '/api/v1/nomadnetwork/nodes') {
        return Promise.resolve({ nodes: [] });
      }
      return Promise.resolve({});
    });
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: { proxyGet },
        db: { getReticulumDestinations: vi.fn().mockResolvedValue([]) },
      },
    });

    const first = refreshReticulumPeersFromSidecar();
    const second = refreshReticulumPeersFromSidecar();
    expect(second).toBe(first);
    releaseFirst();
    await first;

    expect(useReticulumPeerStore.getState().history.get('aa')?.display_name).toBe('Fresh');
    expect(useReticulumPeerStore.getState().history.get('aa')?.last_heard).toBe(99);
    expect(useReticulumPeerStore.getState().contacts.has('aa')).toBe(false);
  });

  it('soft refresh applies when hop counts change with the same peer membership', async () => {
    let peersCalls = 0;
    const proxyGet = vi.fn((path: string) => {
      if (path === '/api/v1/contacts') return Promise.resolve({ contacts: [] });
      if (path.startsWith('/api/v1/peers')) {
        peersCalls += 1;
        return Promise.resolve({
          peers: [{ destination_hash: 'aa', hops: peersCalls === 1 ? 1 : 4, interface: 'tcp' }],
        });
      }
      if (path === '/api/v1/nomadnetwork/nodes') return Promise.resolve({ nodes: [] });
      return Promise.resolve({});
    });
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: { proxyGet },
        db: { getReticulumDestinations: vi.fn().mockResolvedValue([]) },
      },
    });

    await refreshReticulumPeersFromSidecar();
    expect(useReticulumPeerStore.getState().peers.get('aa')?.hops).toBe(1);
    await refreshReticulumPeersFromSidecar();
    expect(useReticulumPeerStore.getState().peers.get('aa')?.hops).toBe(4);
  });

  it('refreshReticulumPeersFromSidecar rethrows rate-limit errors after debug log', async () => {
    const proxyGet = vi.fn().mockRejectedValue(new Error('reticulum:proxy: rate limit exceeded'));
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: { proxyGet },
        db: { getReticulumDestinations: vi.fn().mockResolvedValue([]) },
      },
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await expect(refreshReticulumPeersFromSidecar()).rejects.toThrow('rate limit exceeded');
    expect(debug).toHaveBeenCalled();
    debug.mockRestore();
  });

  it('refreshReticulumPeersFromSidecar OR-accumulates forceRefresh across coalesced callers', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const peersPaths: string[] = [];
    const proxyGet = vi.fn(async (path: string) => {
      if (path.startsWith('/api/v1/peers')) {
        peersPaths.push(path);
        if (peersPaths.length === 1) await firstGate;
        return { peers: [{ destination_hash: 'aa', hops: peersPaths.length }] };
      }
      if (path === '/api/v1/contacts') return { contacts: [] };
      if (path === '/api/v1/nomadnetwork/nodes') return { nodes: [] };
      return {};
    });
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: { proxyGet },
        db: { getReticulumDestinations: vi.fn().mockResolvedValue([]) },
      },
    });

    const soft = refreshReticulumPeersFromSidecar();
    const forced = refreshReticulumPeersFromSidecar({ forceRefresh: true });
    expect(forced).toBe(soft);
    releaseFirst();
    await soft;

    expect(peersPaths[0]).toBe('/api/v1/peers');
    expect(peersPaths).toContain('/api/v1/peers?refresh=1');
    expect(useReticulumPeerStore.getState().peers.get('aa')?.hops).toBe(2);
  });

  it('toggleFavorite rolls back when SQLite upsert fails', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('db down'));
    vi.stubGlobal('window', {
      electronAPI: {
        db: { upsertReticulumDestination: upsert },
      },
    });

    useReticulumPeerStore
      .getState()
      .replacePeers([{ destination_hash: 'deadbeef', display_name: 'Test', favorited: false }]);

    await expect(useReticulumPeerStore.getState().toggleFavorite('deadbeef', true)).rejects.toThrow(
      'db down',
    );
    expect(useReticulumPeerStore.getState().peers.get('deadbeef')?.favorited).toBe(false);
  });

  it('refreshReticulumPeersFromSidecar loads sidecar and db rows', async () => {
    const getReticulumDestinations = vi.fn().mockResolvedValue([
      {
        destination_hash: 'aa',
        icon_name: 'star',
        icon_color: '#0f0',
        last_heard: 5,
      },
    ]);
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: {
          proxyGet: vi.fn((path: string) => {
            if (path === '/api/v1/contacts') {
              return Promise.resolve({ contacts: [{ destination_hash: 'aa', last_heard: 5 }] });
            }
            if (path === '/api/v1/peers') {
              return Promise.resolve({
                peers: [
                  { destination_hash: 'aa', hops: 1 },
                  { destination_hash: 'bb', hops: 3, interface: 'tcp' },
                ],
              });
            }
            if (path === '/api/v1/nomadnetwork/nodes') {
              return Promise.resolve({ nodes: [] });
            }
            return Promise.resolve({});
          }),
        },
        db: {
          getReticulumDestinations,
        },
      },
    });

    const contacts = await refreshReticulumPeersFromSidecar();

    // Wire /contacts without SQLite is_contact → History only.
    expect(contacts).toHaveLength(0);
    expect(getReticulumDestinations).toHaveBeenCalledTimes(1);
    expect(useReticulumPeerStore.getState().peers.get('bb')?.hops).toBe(3);
    expect(useReticulumPeerStore.getState().contacts.has('aa')).toBe(false);
    expect(useReticulumPeerStore.getState().history.get('aa')?.last_heard).toBe(5);
    expect(useReticulumPeerStore.getState().peerAppearanceByHash.get('aa')).toEqual({
      icon_name: 'star',
      icon_color: '#0f0',
    });
  });

  it('applyReticulumAnnounceReceivedOptimistic inserts a peer before path-table refresh', () => {
    applyReticulumAnnounceReceivedOptimistic({
      destination_hash: 'AaBbCcDdEeFf00112233445566778899',
      display_name: 'Hub Peer',
      hops: 1,
    });
    applyReticulumPeerPatchesNow([]);
    const peer = useReticulumPeerStore.getState().peers.get('aabbccddeeff00112233445566778899');
    expect(peer?.display_name).toBe('Hub Peer');
    expect(peer?.hops).toBe(1);
    expect(peer?.last_seen).toEqual(expect.any(Number));
  });

  it('applyReticulumAnnounceReceivedOptimistic accepts nameless announces', () => {
    applyReticulumAnnounceReceivedOptimistic({
      destination_hash: '11223344556677889900aabbccddeeff',
    });
    applyReticulumPeerPatchesNow([]);
    const peer = useReticulumPeerStore.getState().peers.get('11223344556677889900aabbccddeeff');
    expect(peer).toBeDefined();
    expect(peer?.display_name).toBeNull();
  });

  it('applyReticulumAnnounceReceivedOptimistic applies batched announces array', () => {
    applyReticulumAnnounceReceivedOptimistic({
      announces: [
        {
          destination_hash: 'AaBbCcDdEeFf00112233445566778899',
          display_name: 'Batch A',
          hops: 1,
        },
        {
          destination_hash: '11223344556677889900aabbccddeeff',
          display_name: 'Batch B',
          hops: 2,
        },
      ],
    });
    applyReticulumPeerPatchesNow([]);
    expect(
      useReticulumPeerStore.getState().peers.get('aabbccddeeff00112233445566778899')?.display_name,
    ).toBe('Batch A');
    expect(
      useReticulumPeerStore.getState().peers.get('11223344556677889900aabbccddeeff')?.display_name,
    ).toBe('Batch B');
  });

  it('refresh preserves announce alias when path-table peer omits display_name', async () => {
    const hash = 'aabbccddeeff00112233445566778899';
    applyReticulumAnnounceReceivedOptimistic({
      destination_hash: hash,
      display_name: 'Hub Peer',
      hops: 1,
    });
    applyReticulumPeerPatchesNow([]);
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: {
          proxyGet: vi.fn((path: string) => {
            if (path === '/api/v1/contacts') return Promise.resolve({ contacts: [] });
            if (path === '/api/v1/peers') {
              return Promise.resolve({
                peers: [{ destination_hash: hash, hops: 1, interface: 'RNS Testnet' }],
              });
            }
            if (path === '/api/v1/nomadnetwork/nodes') return Promise.resolve({ nodes: [] });
            return Promise.resolve({});
          }),
        },
        db: { getReticulumDestinations: vi.fn().mockResolvedValue([]) },
      },
    });

    await refreshReticulumPeersFromSidecar();

    const peer = useReticulumPeerStore.getState().peers.get(hash);
    expect(peer?.display_name).toBe('Hub Peer');
    expect(peer?.interface).toBe('RNS Testnet');
  });

  it('refresh prefers wire display_name over stale optimistic announce alias', async () => {
    const hash = '11223344556677889900aabbccddeeff';
    applyReticulumAnnounceReceivedOptimistic({
      destination_hash: hash,
      display_name: 'Stale Alias',
      hops: 1,
    });
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: {
          proxyGet: vi.fn((path: string) => {
            if (path === '/api/v1/contacts') return Promise.resolve({ contacts: [] });
            if (path === '/api/v1/peers') {
              return Promise.resolve({
                peers: [
                  {
                    destination_hash: hash,
                    hops: 2,
                    interface: 'tcp',
                    display_name: 'Wire Name',
                  },
                ],
              });
            }
            if (path === '/api/v1/nomadnetwork/nodes') return Promise.resolve({ nodes: [] });
            return Promise.resolve({});
          }),
        },
        db: { getReticulumDestinations: vi.fn().mockResolvedValue([]) },
      },
    });

    await refreshReticulumPeersFromSidecar();

    const peer = useReticulumPeerStore.getState().peers.get(hash);
    expect(peer?.display_name).toBe('Wire Name');
    expect(peer?.hops).toBe(2);
  });

  it('refresh after path keeps announce alias + in-memory icon when contact wire is nameless', async () => {
    const hash = 'aabbccddeeff00112233445566778899';
    applyReticulumAnnounceReceivedOptimistic({
      destination_hash: hash,
      display_name: 'Hub Peer',
      hops: 1,
    });
    applyReticulumPeerPatchesNow([]);
    useReticulumPeerStore.getState().patchPeerAppearance(hash, {
      icon_name: 'star',
      icon_color: 'amber',
    });

    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: {
          proxyGet: vi.fn((path: string) => {
            if (path === '/api/v1/contacts') {
              return Promise.resolve({
                contacts: [{ destination_hash: hash, last_heard: 42, display_name: null }],
              });
            }
            if (path === '/api/v1/peers') {
              return Promise.resolve({
                peers: [{ destination_hash: hash, hops: 2, interface: 'RNS Testnet' }],
              });
            }
            if (path === '/api/v1/nomadnetwork/nodes') return Promise.resolve({ nodes: [] });
            return Promise.resolve({});
          }),
        },
        db: { getReticulumDestinations: vi.fn().mockResolvedValue([]) },
      },
    });

    await refreshReticulumPeersFromSidecar();

    const hist = useReticulumPeerStore.getState().history.get(hash);
    expect(reticulumPeerDisplayName(hist!)).toBe('Hub Peer');
    expect(hist?.hops).toBe(2);
    expect(useReticulumPeerStore.getState().contacts.has(hash)).toBe(false);
    expect(useReticulumPeerStore.getState().peerAppearanceByHash.get(hash)).toEqual({
      icon_name: 'star',
      icon_color: 'amber',
    });
  });
});

describe('reticulumContactToNodeRecordPreservingLabel', () => {
  it('keeps prior longName when contact label collapses to hash prefix', () => {
    const hash = 'aabbccddeeff00112233445566778899';
    const record = reticulumContactToNodeRecordPreservingLabel(
      { destination_hash: hash, display_name: null, last_heard: 1 },
      { nodeId: 1, longName: 'Prior Name', shortName: 'Prio' },
    );
    expect(record.longName).toBe('Prior Name');
    expect(record.shortName).toBe('Prio');
  });

  it('adopts a new real wire name', () => {
    const hash = 'aabbccddeeff00112233445566778899';
    const record = reticulumContactToNodeRecordPreservingLabel(
      { destination_hash: hash, display_name: 'Fresh', last_heard: 1 },
      { nodeId: 1, longName: 'Prior Name' },
    );
    expect(record.longName).toBe('Fresh');
  });
});

describe('mergePeerAppearancesFromDb', () => {
  it('keeps prior icons when DB row is missing appearance', () => {
    const fromDb = new Map();
    const prior = new Map([['aa'.repeat(16), { icon_name: 'heart', icon_color: 'cyan' }]]);
    const merged = mergePeerAppearancesFromDb(fromDb, prior);
    expect(merged.get('aa'.repeat(16))).toEqual({ icon_name: 'heart', icon_color: 'cyan' });
  });

  it('prefers DB appearance when present', () => {
    const hash = 'bb'.repeat(16);
    const fromDb = new Map([[hash, { icon_name: 'star', icon_color: 'green' }]]);
    const prior = new Map([[hash, { icon_name: 'heart', icon_color: 'cyan' }]]);
    expect(mergePeerAppearancesFromDb(fromDb, prior).get(hash)).toEqual({
      icon_name: 'star',
      icon_color: 'green',
    });
  });
});

describe('reticulumSelfIdentityToNodeRecord', () => {
  it('uses identity display name for self node labels', async () => {
    const { reticulumSelfIdentityToNodeRecord } = await import('./reticulumPeerStore');
    const { reticulumHashToNodeId } = await import('@/renderer/lib/reticulum/destHash');
    const hash = 'f8b4e04e1234567890abcdef';
    const record = reticulumSelfIdentityToNodeRecord(hash, 'NV0N');
    expect(record.longName).toBe('NV0N');
    expect(record.shortName).toBe('NV0N');
    expect(record.nodeId).toBe(reticulumHashToNodeId(hash));
  });

  it('falls back to hash prefix when display name is missing', async () => {
    const { reticulumSelfIdentityToNodeRecord } = await import('./reticulumPeerStore');
    const record = reticulumSelfIdentityToNodeRecord('f8b4e04e1234567890abcdef', null);
    expect(record.longName).toBe('f8b4e04e1234');
    expect(record.shortName).toBe('f8b4');
  });
});
