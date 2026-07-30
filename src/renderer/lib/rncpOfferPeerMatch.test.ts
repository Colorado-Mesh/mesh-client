import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';

import { rncpOfferMatchesLxmfPeer } from './rncpOfferPeerMatch';

describe('rncpOfferMatchesLxmfPeer', () => {
  const lxmf = 'ab'.repeat(16);
  const identity = 'cd'.repeat(16);

  beforeEach(() => {
    useReticulumIdentityActivityStore.setState({ byDestination: new Map() });
    useReticulumRemoteAddressStore.getState().clear();
  });

  it('matches via identity activity for the LXMF destination', () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          lxmf,
          [
            {
              destination_hash: lxmf,
              aspect: 'lxmf.delivery',
              identity_hash: identity,
              last_seen: Date.now(),
            },
          ],
        ],
      ]),
    });
    expect(rncpOfferMatchesLxmfPeer(identity, lxmf)).toBe(true);
    expect(rncpOfferMatchesLxmfPeer('ee'.repeat(16), lxmf)).toBe(false);
  });

  it('matches via saved remote address identity_hash', () => {
    useReticulumRemoteAddressStore.setState({
      addresses: new Map([
        [
          '1',
          {
            id: '1',
            label: 'Peer',
            service: 'rncp',
            destination_hash: 'ff'.repeat(16),
            identity_hash: identity,
            lxmf_peer_hash: lxmf,
            created_at: 1,
            updated_at: 1,
          },
        ],
      ]),
      hydrated: true,
      loading: false,
    });
    expect(rncpOfferMatchesLxmfPeer(identity, lxmf)).toBe(true);
  });

  it('returns false when offer has no identity', () => {
    expect(rncpOfferMatchesLxmfPeer(null, lxmf)).toBe(false);
  });
});
