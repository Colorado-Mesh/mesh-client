import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearReticulumHashRegistry,
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { LXMF_DELIVERY_ASPECT } from '@/renderer/lib/reticulum/resolveReticulumChatLxmfDest';
import { LXST_TELEPHONY_ASPECT } from '@/renderer/lib/reticulumVoiceCapability';
import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';

import {
  resetReticulumDmFaceHashNegativeCacheForTests,
  resolveReticulumDmBoundDestinationHash,
  resolveReticulumDmFaceHash,
} from './reticulumChatFaceHash';

const reticulumHashForNodeIdMock = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/stores/reticulumPeerStore', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('@/renderer/stores/reticulumPeerStore')>();
  return {
    ...actual,
    reticulumHashForNodeId: ((nodeId: number) =>
      reticulumHashForNodeIdMock(nodeId)) as typeof actual.reticulumHashForNodeId,
  };
});

describe('resolveReticulumDmFaceHash', () => {
  const hash = 'a7b3c9d1e5f20681943ab2de77fc8e01';
  const nodeNum = reticulumHashToNodeId(hash);

  beforeEach(() => {
    clearReticulumHashRegistry();
    resetReticulumDmFaceHashNegativeCacheForTests();
    useReticulumPeerStore.setState({ peersRevision: 1 });
    useReticulumIdentityActivityStore.setState({ byDestination: new Map() });
    reticulumHashForNodeIdMock.mockReset();
    reticulumHashForNodeIdMock.mockReturnValue(null as string | null);
  });

  it('prefers node destination hash and registers it', () => {
    expect(resolveReticulumDmFaceHash(nodeNum, hash.toUpperCase())).toBe(hash);
    expect(resolveReticulumDmFaceHash(nodeNum)).toBe(hash);
  });

  it('falls back to registry when node hash missing', () => {
    registerReticulumDestinationHash(nodeNum, hash);
    expect(resolveReticulumDmFaceHash(nodeNum, null)).toBe(hash);
  });

  it('returns null when hash cannot be resolved', () => {
    expect(resolveReticulumDmFaceHash(999_001, null)).toBeNull();
  });

  it('rejects non-canonical node hashes', () => {
    expect(resolveReticulumDmFaceHash(nodeNum, 'not-a-hash')).toBeNull();
  });

  it('negative-caches unresolved nodeNums until peersRevision changes', () => {
    expect(resolveReticulumDmFaceHash(42_001, null)).toBeNull();
    expect(resolveReticulumDmFaceHash(42_001, null)).toBeNull();
    expect(reticulumHashForNodeIdMock).toHaveBeenCalledTimes(1);

    useReticulumPeerStore.setState({ peersRevision: 2 });
    expect(resolveReticulumDmFaceHash(42_001, null)).toBeNull();
    expect(reticulumHashForNodeIdMock).toHaveBeenCalledTimes(2);
  });

  it('resolves after lxmf.delivery activity lands without peersRevision change', () => {
    const identity = '0f79468863d76b3ba574baa92606ffcb';
    const lxmf = 'e3359f1314aff4fb6261400a8202149b';
    const telephony = 'ab1d53d6923d6983dfb4451e3869b878';
    const telephonyNum = reticulumHashToNodeId(telephony);
    reticulumHashForNodeIdMock.mockImplementation((id: number) =>
      id === telephonyNum ? telephony : null,
    );
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          telephony,
          [
            {
              destination_hash: telephony,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: identity,
              last_seen: 1,
            },
          ],
        ],
      ]),
    });
    expect(resolveReticulumDmFaceHash(telephonyNum, null)).toBeNull();

    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          telephony,
          [
            {
              destination_hash: telephony,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: identity,
              last_seen: 1,
            },
          ],
        ],
        [
          lxmf,
          [
            {
              destination_hash: lxmf,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: identity,
              last_seen: 2,
            },
          ],
        ],
      ]),
    });
    expect(useReticulumPeerStore.getState().peersRevision).toBe(1);
    expect(resolveReticulumDmFaceHash(telephonyNum, null)).toBe(lxmf);
  });

  it('returns null for telephony-only without caching; bound hash still available', () => {
    const identity = '0f79468863d76b3ba574baa92606ffcb';
    const telephony = 'ab1d53d6923d6983dfb4451e3869b878';
    const telephonyNum = reticulumHashToNodeId(telephony);
    reticulumHashForNodeIdMock.mockImplementation((id: number) =>
      id === telephonyNum ? telephony : null,
    );
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          telephony,
          [
            {
              destination_hash: telephony,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: identity,
              last_seen: 1,
            },
          ],
        ],
      ]),
    });
    expect(resolveReticulumDmFaceHash(telephonyNum, null)).toBeNull();
    expect(resolveReticulumDmBoundDestinationHash(telephonyNum, null)).toBe(telephony);
    expect(resolveReticulumDmBoundDestinationHash(telephonyNum, telephony)).toBe(telephony);
  });

  it('remaps a bound RNS identity hash to lxmf.delivery for DM probe/face', () => {
    const identity = '0f79468863d76b3ba574baa92606ffcb';
    const lxmf = 'e3359f1314aff4fb6261400a8202149b';
    const identityNum = reticulumHashToNodeId(identity);
    reticulumHashForNodeIdMock.mockImplementation((id: number) =>
      id === identityNum ? identity : null,
    );
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          lxmf,
          [
            {
              destination_hash: lxmf,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: identity,
              last_seen: 2,
            },
          ],
        ],
      ]),
    });
    expect(resolveReticulumDmFaceHash(identityNum, identity)).toBe(lxmf);
    expect(resolveReticulumDmFaceHash(identityNum, null)).toBe(lxmf);
  });
});
