import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearReticulumHashRegistry,
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';

import { resolveReticulumDmFaceHash } from './reticulumChatFaceHash';

describe('resolveReticulumDmFaceHash', () => {
  const hash = 'a7b3c9d1e5f20681943ab2de77fc8e01';
  const nodeNum = reticulumHashToNodeId(hash);

  beforeEach(() => {
    clearReticulumHashRegistry();
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
});
