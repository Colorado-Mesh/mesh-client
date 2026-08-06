import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';

import {
  resolveReticulumRemoteHashLabel,
  resolveReticulumVoiceRemoteLabel,
} from './reticulumVoiceRemoteLabel';

const DEST = 'a'.repeat(32);
const ID = 'b'.repeat(32);

describe('resolveReticulumRemoteHashLabel', () => {
  beforeEach(() => {
    useReticulumPeerStore.getState().clearPeers();
    useReticulumIdentityActivityStore.setState({ byDestination: new Map() });
  });

  it('returns short hash when peer unknown', () => {
    expect(resolveReticulumRemoteHashLabel(DEST)).toBe(DEST.slice(0, 12));
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
    expect(resolveReticulumRemoteHashLabel(DEST)).toBe('Alice Radio');
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
    expect(resolveReticulumRemoteHashLabel(ID)).toBe('Bob Mesh');
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
    expect(resolveReticulumRemoteHashLabel(ID)).toBe('Custom Bob');
  });

  it('voice alias shares the same resolver', () => {
    useReticulumPeerStore.setState({
      peers: new Map([
        [
          DEST,
          {
            destination_hash: DEST,
            identity_hash: ID,
            display_name: 'Shared Alice',
            hops: 1,
          },
        ],
      ]),
    });
    expect(resolveReticulumVoiceRemoteLabel(DEST)).toBe(resolveReticulumRemoteHashLabel(DEST));
    expect(resolveReticulumVoiceRemoteLabel(DEST)).toBe('Shared Alice');
  });
});
