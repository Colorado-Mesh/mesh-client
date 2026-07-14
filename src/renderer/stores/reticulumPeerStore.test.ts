import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReticulumContact } from '@/shared/reticulum-types';

import {
  applyReticulumAnnounceReceivedOptimistic,
  applyReticulumPeerPatchesNow,
  applyReticulumPeersUpdatedPatches,
  capReticulumPeerMaps,
  mergeReticulumPeerMaps,
  refreshReticulumPeersFromSidecar,
  resetReticulumPeerPatchBufferForTests,
  resetReticulumPeerRefreshSingleFlightForTests,
  resolveReticulumPeerLabel,
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
  it('keeps newest peers by last_seen and drops orphaned contacts', () => {
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
    const { peers: cappedPeers, contacts: cappedContacts } = capReticulumPeerMaps(
      peers,
      contacts,
      2,
    );
    expect(cappedPeers.size).toBe(2);
    expect(cappedPeers.has('new')).toBe(true);
    expect(cappedPeers.has('mid')).toBe(true);
    expect(cappedContacts.has('mid')).toBe(true);
    expect(cappedContacts.has('orphan')).toBe(false);
  });
});

describe('mergeReticulumPeerMaps', () => {
  it('merges peers and contacts with SQLite overlay', () => {
    const { peers, contacts } = mergeReticulumPeerMaps(
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
    expect(contacts.get('def456')?.last_heard).toBe(1000);
    expect(peers.has('def456')).toBe(true);
  });

  it('does not promote favorited path peers without last_heard into contacts', () => {
    const { peers, contacts } = mergeReticulumPeerMaps(
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
  });

  it('promotes SQLite rows with last_heard into contacts (Save Contact)', () => {
    const { peers, contacts } = mergeReticulumPeerMaps(
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
          favorited: 0,
        },
      ],
    );

    expect(contacts.get('aabb02')?.last_heard).toBe(1_700_000_000);
    expect(contacts.get('aabb02')?.custom_display_name).toBe('Saved Label');
    expect(contacts.get('aabb02')?.hops).toBe(3);
    expect(peers.has('aabb02')).toBe(true);
  });

  it('promotes DB-only last_heard rows into contacts when peer is absent', () => {
    const { peers, contacts } = mergeReticulumPeerMaps(
      [],
      [],
      [
        {
          destination_hash: 'aabb03',
          display_name: 'Offline Contact',
          last_heard: 1_700_000_100,
          favorited: 1,
        },
      ],
    );

    expect(contacts.get('aabb03')?.last_heard).toBe(1_700_000_100);
    expect(contacts.get('aabb03')?.favorited).toBe(true);
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

  it('reflects contact fields on the merged peer entry and applies SQLite overlay to contacts', () => {
    const { peers, contacts } = mergeReticulumPeerMaps(
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
        },
      ],
    );

    const contact = contacts.get('def456');
    expect(contact?.last_heard).toBe(1000);
    expect(contact?.hops).toBe(1);
    expect(contact?.favorited).toBe(true);
    expect(contact?.custom_display_name).toBe('Saved Contact');

    const peer = peers.get('def456') as ReticulumContact | undefined;
    expect(peer?.last_heard).toBe(1000);
    expect(peer?.hops).toBe(1);
    expect(peer?.favorited).toBe(true);
    expect(peer?.custom_display_name).toBe('Saved Contact');
    expect(peer?.display_name).toBe('Contact B');
  });
});

describe('reticulumPeerStore', () => {
  beforeEach(() => {
    resetReticulumPeerRefreshSingleFlightForTests();
    resetReticulumPeerPatchBufferForTests();
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map(),
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

  it('clearPeers empties peers and contacts', () => {
    useReticulumPeerStore.getState().replacePeers([{ destination_hash: 'aa' }]);
    useReticulumPeerStore.getState().replaceContacts([{ destination_hash: 'bb', last_heard: 1 }]);
    useReticulumPeerStore.getState().clearPeers();
    expect(useReticulumPeerStore.getState().peers.size).toBe(0);
    expect(useReticulumPeerStore.getState().contacts.size).toBe(0);
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

    expect(useReticulumPeerStore.getState().contacts.get('aa')?.display_name).toBe('Fresh');
    expect(useReticulumPeerStore.getState().contacts.get('aa')?.last_heard).toBe(99);
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

    expect(contacts).toHaveLength(1);
    expect(getReticulumDestinations).toHaveBeenCalledTimes(1);
    expect(useReticulumPeerStore.getState().peers.get('bb')?.hops).toBe(3);
    expect(useReticulumPeerStore.getState().contacts.get('aa')?.last_heard).toBe(5);
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
