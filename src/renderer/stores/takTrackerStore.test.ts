import { afterEach, describe, expect, it } from 'vitest';

import type { Mt1Fix } from '../lib/meshcore/mt1Tracker';
import {
  clearTakTrackerFixes,
  recordTakTrackerFix,
  TAK_TRACKER_DEFAULT_STALE_MS,
  TAK_TRACKER_MAX_FIXES,
  useTakTrackerStore,
} from './takTrackerStore';

function fix(overrides: Partial<Mt1Fix> = {}): Mt1Fix {
  return { callsign: 'Rex', id8: 'a1b2c3d4', lat: 1, lon: 2, ...overrides };
}

afterEach(() => {
  clearTakTrackerFixes();
});

describe('takTrackerStore', () => {
  it('keeps the latest fix per tracker', () => {
    recordTakTrackerFix(fix({ seq: 1 }), 1000);
    recordTakTrackerFix(fix({ seq: 2, lat: 3 }), 2000, 1);
    expect(useTakTrackerStore.getState().fixes.a1b2c3d4).toEqual({
      fix: fix({ seq: 2, lat: 3 }),
      receivedAtMs: 2000,
      hops: 1,
    });
  });

  it('ignores an out-of-order fix with a lower sequence', () => {
    recordTakTrackerFix(fix({ seq: 5, lat: 5 }), 1000);
    recordTakTrackerFix(fix({ seq: 4, lat: 4 }), 2000);
    expect(useTakTrackerStore.getState().fixes.a1b2c3d4.fix.lat).toBe(5);
  });

  it('accepts a lower sequence once the previous fix expired (tracker rebooted)', () => {
    recordTakTrackerFix(fix({ seq: 5 }), 0);
    recordTakTrackerFix(fix({ seq: 1, lat: 9 }), TAK_TRACKER_DEFAULT_STALE_MS + 1);
    expect(useTakTrackerStore.getState().fixes.a1b2c3d4.fix.lat).toBe(9);
  });

  it('prunes expired fixes of other trackers', () => {
    recordTakTrackerFix(fix({ id8: '00000001', staleSec: 30 }), 0);
    recordTakTrackerFix(fix({ id8: '00000002' }), 31_000);
    expect(Object.keys(useTakTrackerStore.getState().fixes)).toEqual(['00000002']);
  });

  it('caps the number of trackers kept', () => {
    for (let i = 1; i <= TAK_TRACKER_MAX_FIXES + 5; i++) {
      recordTakTrackerFix(fix({ id8: i.toString(16).padStart(8, '0') }), i);
    }
    const ids = Object.keys(useTakTrackerStore.getState().fixes);
    expect(ids).toHaveLength(TAK_TRACKER_MAX_FIXES);
    expect(ids).not.toContain('00000001');
  });
});
