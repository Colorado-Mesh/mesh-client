import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';

import { resolveReticulumVoiceRemoteLabel } from './reticulumVoiceRemoteLabel';

const DEST = 'a'.repeat(32);
const ID = 'b'.repeat(32);

describe('resolveReticulumVoiceRemoteLabel', () => {
  beforeEach(() => {
    useReticulumPeerStore.getState().clearPeers();
    useReticulumIdentityActivityStore.setState({ byDestination: new Map() });
  });

  it('returns short hash when peer unknown', () => {
    expect(resolveReticulumVoiceRemoteLabel(DEST)).toBe(DEST.slice(0, 12));
  });

  it('resolves display name when remote is LXMF destination', () => {
    useReticulumPeerStore.setState({
      peers: new Map([
        [
          DEST,
          {
            destination_hash: DEST,
            identity_hash: ID,
            display_name: 'Alice Radio',
            hops: 1,
          },
        ],
      ]),
    });
    expect(resolveReticulumVoiceRemoteLabel(DEST)).toBe('Alice Radio');
  });

  it('resolves display name when remote is identity hash', () => {
    useReticulumPeerStore.setState({
      peers: new Map([
        [
          DEST,
          {
            destination_hash: DEST,
            identity_hash: ID,
            display_name: 'Bob Mesh',
            hops: 2,
          },
        ],
      ]),
    });
    expect(resolveReticulumVoiceRemoteLabel(ID)).toBe('Bob Mesh');
  });

  it('prefers custom_display_name over wire name', () => {
    useReticulumPeerStore.setState({
      peers: new Map([
        [
          DEST,
          {
            destination_hash: DEST,
            identity_hash: ID,
            display_name: 'Wire Name',
            custom_display_name: 'Custom Bob',
            hops: 0,
          },
        ],
      ]),
    });
    expect(resolveReticulumVoiceRemoteLabel(ID)).toBe('Custom Bob');
  });
});
