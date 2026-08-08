import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearReticulumPropagationSyncFailure,
  hasRecentReticulumPropagationSyncFailure,
  noteReticulumPropagationSyncFailure,
  omitRecentlyFailedPropagationTargets,
  resetReticulumPropagationSyncFailures,
  RETICULUM_PROPAGATION_SYNC_FAILURE_BACKOFF_MS,
} from './reticulumPropagationSyncBackoff';

describe('reticulumPropagationSyncBackoff', () => {
  beforeEach(() => {
    resetReticulumPropagationSyncFailures();
  });

  it('omits recently failed targets so the cascade can fall through to local', () => {
    noteReticulumPropagationSyncFailure('catz', 1_000);

    expect(
      omitRecentlyFailedPropagationTargets(['catz', 'near', 'far'], (id) => id, 2_000),
    ).toEqual(['near', 'far']);
  });

  it('returns an empty list when every candidate failed recently', () => {
    noteReticulumPropagationSyncFailure('a', 1_000);
    noteReticulumPropagationSyncFailure('b', 1_000);

    expect(omitRecentlyFailedPropagationTargets(['a', 'b'], (id) => id, 2_000)).toEqual([]);
  });

  it('restores a target once the backoff window elapses', () => {
    noteReticulumPropagationSyncFailure('catz', 1_000);
    const after = 1_000 + RETICULUM_PROPAGATION_SYNC_FAILURE_BACKOFF_MS;

    expect(hasRecentReticulumPropagationSyncFailure('catz', after)).toBe(false);
    expect(omitRecentlyFailedPropagationTargets(['catz', 'near'], (id) => id, after)).toEqual([
      'catz',
      'near',
    ]);
  });

  it('matches target ids case-insensitively so destination hashes line up', () => {
    noteReticulumPropagationSyncFailure('AABB1111', 1_000);

    expect(hasRecentReticulumPropagationSyncFailure('aabb1111', 2_000)).toBe(true);
  });

  it('forgets a target after a success clears it', () => {
    noteReticulumPropagationSyncFailure('catz', 1_000);
    clearReticulumPropagationSyncFailure('catz');

    expect(hasRecentReticulumPropagationSyncFailure('catz', 2_000)).toBe(false);
  });
});
