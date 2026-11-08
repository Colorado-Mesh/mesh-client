/**
 * Cold-start timeline marks for Support / debug snapshots.
 * Durations are ms from `performance.now()` at mark time (navigation / isolate start).
 */

import { recordRendererTiming } from './rendererTimings';

export type LaunchMilestone =
  'secretsReady' | 'pruneDone' | 'activeHydrateDone' | 'inactiveHydrateDone';

const marked = new Set<LaunchMilestone>();

/** Record a once-per-session launch milestone (no-op if already marked). */
export function markLaunchMilestone(name: LaunchMilestone): void {
  if (marked.has(name)) return;
  marked.add(name);
  const elapsedMs = performance.now();
  recordRendererTiming(`launch:${name}`, elapsedMs);
  console.debug(`[Startup] launch:${name} +${elapsedMs.toFixed(1)}ms`);
}

/** @internal Test helper. */
export function resetLaunchMilestonesForTests(): void {
  marked.clear();
}
