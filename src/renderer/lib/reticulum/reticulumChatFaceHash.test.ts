import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearReticulumHashRegistry,
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';

import {
  resetReticulumDmFaceHashNegativeCacheForTests,
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
});
