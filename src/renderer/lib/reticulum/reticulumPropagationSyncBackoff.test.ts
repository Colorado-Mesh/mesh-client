import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearReticulumPropagationSyncFailure,
  deprioritizeRecentlyFailedPropagationTargets,
  hasRecentReticulumPropagationSyncFailure,
  noteReticulumPropagationSyncFailure,
  resetReticulumPropagationSyncFailures,
  RETICULUM_PROPAGATION_SYNC_FAILURE_BACKOFF_MS,
} from './reticulumPropagationSyncBackoff';

describe('reticulumPropagationSyncBackoff', () => {
  beforeEach(() => {
    resetReticulumPropagationSyncFailures();
  });

  it('moves recently failed targets behind untried ones without dropping them', () => {
    noteReticulumPropagationSyncFailure('catz', 1_000);

    expect(
      deprioritizeRecentlyFailedPropagationTargets(['catz', 'near', 'far'], (id) => id, 2_000),
    ).toEqual(['near', 'far', 'catz']);
  });

  it('keeps the original order within each group', () => {
    noteReticulumPropagationSyncFailure('a', 1_000);
    noteReticulumPropagationSyncFailure('c', 1_000);

    expect(
      deprioritizeRecentlyFailedPropagationTargets(['a', 'b', 'c', 'd'], (id) => id, 2_000),
    ).toEqual(['b', 'd', 'a', 'c']);
  });

  it('restores a target once the backoff window elapses', () => {
    noteReticulumPropagationSyncFailure('catz', 1_000);
    const after = 1_000 + RETICULUM_PROPAGATION_SYNC_FAILURE_BACKOFF_MS;

    expect(hasRecentReticulumPropagationSyncFailure('catz', after)).toBe(false);
    expect(
      deprioritizeRecentlyFailedPropagationTargets(['catz', 'near'], (id) => id, after),
    ).toEqual(['catz', 'near']);
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
