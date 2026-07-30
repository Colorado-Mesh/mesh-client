import { describe, expect, it } from 'vitest';

import { shouldDeletePriorReticulumOutboundHash } from './reticulumOutboundRetry';

describe('shouldDeletePriorReticulumOutboundHash', () => {
  it('deletes when rekeying away from a prior LXMF hash', () => {
    expect(shouldDeletePriorReticulumOutboundHash('aa'.repeat(32), 'bb'.repeat(32))).toBe(true);
  });

  it('keeps optimistic pending rows (no prior SQLite hash)', () => {
    expect(shouldDeletePriorReticulumOutboundHash('reticulum-pending-1', 'bb'.repeat(32))).toBe(
      false,
    );
  });

  it('skips when pending id already matches the new hash', () => {
    const hash = 'cc'.repeat(32);
    expect(shouldDeletePriorReticulumOutboundHash(hash, hash)).toBe(false);
  });
});
