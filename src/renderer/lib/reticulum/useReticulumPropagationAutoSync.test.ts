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
        lastPropagationSyncAttemptAt: null,
        nowMs: 0,
      }),
    ).toBe(false);

    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: true,
        lastPropagationSyncAt: null,
        lastPropagationSyncAttemptAt: null,
        nowMs: 4_000_000,
      }),
    ).toBe(false);
  });

  it('returns false when preferredId is missing', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: null,
        syncActive: false,
        lastPropagationSyncAt: null,
        lastPropagationSyncAttemptAt: null,
        nowMs: 4_000_000,
      }),
    ).toBe(false);
  });

  it('returns false when preferredId is local-prop', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'local-prop',
        syncActive: false,
        lastPropagationSyncAt: null,
        lastPropagationSyncAttemptAt: null,
        nowMs: 4_000_000,
      }),
    ).toBe(false);
  });

  it('allows first sync when never attempted or succeeded', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: null,
        lastPropagationSyncAttemptAt: null,
        nowMs: 1_000,
      }),
    ).toBe(true);
  });

  it('returns true when interval elapsed since last success', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: 0,
        lastPropagationSyncAttemptAt: null,
        nowMs: 3_600_000,
      }),
    ).toBe(true);
  });

  it('returns false when a failed attempt is still within the interval', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: null,
        lastPropagationSyncAttemptAt: 1_000,
        nowMs: 1_000 + 30_000,
      }),
    ).toBe(false);
  });

  it('returns true when interval elapsed since last attempt', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: null,
        lastPropagationSyncAttemptAt: 1_000,
        nowMs: 1_000 + 3_600_000,
      }),
    ).toBe(true);
  });

  it('prefers last attempt over older success for backoff', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: 0,
        lastPropagationSyncAttemptAt: 3_000_000,
        nowMs: 3_000_000 + 30_000,
      }),
    ).toBe(false);
  });
});
