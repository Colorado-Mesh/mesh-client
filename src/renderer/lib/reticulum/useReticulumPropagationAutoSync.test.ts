import { describe, expect, it } from 'vitest';

import { shouldRunPropagationAutoSync } from './useReticulumPropagationAutoSync';

describe('shouldRunPropagationAutoSync', () => {
  it('returns false when disabled or sync is active', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 0,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: null,
        nowMs: 0,
      }),
    ).toBe(false);

    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: true,
        lastPropagationSyncAt: null,
        nowMs: 4_000_000,
      }),
    ).toBe(false);
  });

  it('returns true when interval elapsed', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: 0,
        nowMs: 3_600_000,
      }),
    ).toBe(true);
  });
});
