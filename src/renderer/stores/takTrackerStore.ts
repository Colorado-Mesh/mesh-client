import { create } from 'zustand';

import type { Mt1Fix } from '../lib/meshcore/mt1Tracker';
import { MS_PER_MINUTE, MS_PER_SECOND } from '../lib/timeConstants';

/** A tracker fix is relayed this long when it does not say how long it stays valid. */
export const TAK_TRACKER_DEFAULT_STALE_MS = 10 * MS_PER_MINUTE;
/** Oldest trackers drop past this so a busy channel cannot grow the store unbounded. */
export const TAK_TRACKER_MAX_FIXES = 500;

export interface TakTrackerEntry {
  fix: Mt1Fix;
  receivedAtMs: number;
  hops?: number;
}

interface TakTrackerState {
  /** Latest fix per tracker id8. */
  fixes: Record<string, TakTrackerEntry>;
}

export const useTakTrackerStore = create<TakTrackerState>()(() => ({ fixes: {} }));

export function takTrackerExpiresAtMs(entry: TakTrackerEntry): number {
  const window =
    entry.fix.staleSec != null ? entry.fix.staleSec * MS_PER_SECOND : TAK_TRACKER_DEFAULT_STALE_MS;
  return entry.receivedAtMs + window;
}

/** Store a fix, ignoring one older than the tracker's last (lower sequence), and prune expired. */
export function recordTakTrackerFix(fix: Mt1Fix, nowMs: number, hops?: number): void {
  useTakTrackerStore.setState((s) => {
    const prev = s.fixes[fix.id8];
    if (
      prev?.fix.seq != null &&
      fix.seq != null &&
      fix.seq < prev.fix.seq &&
      nowMs < takTrackerExpiresAtMs(prev)
    ) {
      return s;
    }
    const entries = Object.entries(s.fixes).filter(
      ([id, e]) => id !== fix.id8 && takTrackerExpiresAtMs(e) > nowMs,
    );
    entries.push([fix.id8, { fix, receivedAtMs: nowMs, ...(hops != null ? { hops } : {}) }]);
    entries.sort((a, b) => a[1].receivedAtMs - b[1].receivedAtMs);
    return { fixes: Object.fromEntries(entries.slice(-TAK_TRACKER_MAX_FIXES)) };
  });
}

export function clearTakTrackerFixes(): void {
  useTakTrackerStore.setState({ fixes: {} });
}
