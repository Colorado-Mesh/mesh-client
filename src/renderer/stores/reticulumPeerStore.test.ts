import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mergeReticulumPeerMaps,
  refreshReticulumPeersFromSidecar,
  useReticulumPeerStore,
} from './reticulumPeerStore';

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
    expect(contacts.get('def456')?.last_heard).toBe(1000);
    expect(peers.has('def456')).toBe(true);
  });
});

describe('reticulumPeerStore', () => {
  beforeEach(() => {
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map(),
      lastRefreshAt: null,
    });
    vi.restoreAllMocks();
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
  });

  it('refreshReticulumPeersFromSidecar loads sidecar and db rows', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: {
          proxyGet: vi.fn((path: string) => {
            if (path === '/api/v1/contacts') {
              return Promise.resolve({ contacts: [{ destination_hash: 'aa', last_heard: 5 }] });
            }
            if (path === '/api/v1/peers') {
              return Promise.resolve({
                peers: [{ destination_hash: 'bb', hops: 3, interface: 'tcp' }],
              });
            }
            return Promise.resolve({});
          }),
        },
        db: {
          getReticulumDestinations: vi.fn().mockResolvedValue([]),
        },
      },
    });

    const contacts = await refreshReticulumPeersFromSidecar();

    expect(contacts).toHaveLength(1);
    expect(useReticulumPeerStore.getState().peers.get('bb')?.hops).toBe(3);
    expect(useReticulumPeerStore.getState().contacts.get('aa')?.last_heard).toBe(5);
  });
});
