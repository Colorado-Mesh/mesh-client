import { describe, expect, it } from 'vitest';

import {
  PROPAGATION_AUTO_SYNC_FAILURE_COOLDOWN_MS,
  shouldRunPropagationAutoSync,
} from './useReticulumPropagationAutoSync';

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

  it('returns false when mode is off even with a remote preferred', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: null,
        lastPropagationSyncAttemptAt: null,
        nowMs: 4_000_000,
        mode: 'off',
      }),
    ).toBe(false);
  });

  it('syncs a remote preferred in auto and manual modes', () => {
    for (const mode of ['auto', 'manual'] as const) {
      expect(
        shouldRunPropagationAutoSync({
          autoSyncIntervalSec: 3600,
          preferredId: 'pn-test',
          syncActive: false,
          lastPropagationSyncAt: null,
          lastPropagationSyncAttemptAt: null,
          nowMs: 4_000_000,
          mode,
        }),
      ).toBe(true);
    }
  });

  it('allows local-prop Preferred in auto and manual (final settle / only-local)', () => {
    for (const mode of ['auto', 'manual'] as const) {
      expect(
        shouldRunPropagationAutoSync({
          autoSyncIntervalSec: 3600,
          preferredId: 'local-prop',
          syncActive: false,
          lastPropagationSyncAt: null,
          lastPropagationSyncAttemptAt: null,
          nowMs: 4_000_000,
          mode,
        }),
      ).toBe(true);
    }
  });

  it('allows Auto and Manual with null Preferred when cascade candidates exist', () => {
    for (const mode of ['auto', 'manual'] as const) {
      expect(
        shouldRunPropagationAutoSync({
          autoSyncIntervalSec: 3600,
          preferredId: null,
          syncActive: false,
          lastPropagationSyncAt: null,
          lastPropagationSyncAttemptAt: null,
          nowMs: 4_000_000,
          mode,
          hasCascadeCandidate: true,
        }),
      ).toBe(true);
    }
  });

  it('returns false in Manual with null Preferred and no cascade candidate', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: null,
        syncActive: false,
        lastPropagationSyncAt: null,
        lastPropagationSyncAttemptAt: null,
        nowMs: 4_000_000,
        mode: 'manual',
        hasCascadeCandidate: false,
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

  it('returns false when a failed attempt is still within the interval (never succeeded)', () => {
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

  it('returns true when interval elapsed since last attempt (never succeeded)', () => {
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

  it('does not let a recent failed attempt postpone the success interval forever', () => {
    // Success at t=0; failed retry well after interval; now past failure cooldown.
    const attemptAt = 3_600_000;
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: 0,
        lastPropagationSyncAttemptAt: attemptAt,
        nowMs: attemptAt + PROPAGATION_AUTO_SYNC_FAILURE_COOLDOWN_MS,
      }),
    ).toBe(true);
  });

  it('applies failure cooldown even when success interval has elapsed', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 3600,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: 0,
        lastPropagationSyncAttemptAt: 3_550_000,
        nowMs: 3_600_000,
      }),
    ).toBe(false);
  });

  it('allows auto-sync after failure cooldown when success interval elapsed', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 900,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: 0,
        lastPropagationSyncAttemptAt: 900_000,
        nowMs: 900_000 + PROPAGATION_AUTO_SYNC_FAILURE_COOLDOWN_MS,
      }),
    ).toBe(true);
  });

  it('ignores attempt stamp from the successful sync when interval has elapsed', () => {
    // Short interval (API may allow < cooldown): attempt from the successful run must not block.
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 60,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: 60_000,
        lastPropagationSyncAttemptAt: 55_000,
        nowMs: 60_000 + 60_000,
      }),
    ).toBe(true);
  });

  it('ignores attempt when cleared after success (null)', () => {
    expect(
      shouldRunPropagationAutoSync({
        autoSyncIntervalSec: 60,
        preferredId: 'pn-test',
        syncActive: false,
        lastPropagationSyncAt: 0,
        lastPropagationSyncAttemptAt: null,
        nowMs: 60_000,
      }),
    ).toBe(true);
  });
});
