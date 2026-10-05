import { describe, expect, it } from 'vitest';

import { createMeshtasticPostConfigureSilenceTracker } from './meshtasticPostConfigureSilence';

function silentCycle(tracker: ReturnType<typeof createMeshtasticPostConfigureSilenceTracker>) {
  tracker.markConfigured();
  return tracker.noteDead();
}

describe('createMeshtasticPostConfigureSilenceTracker', () => {
  it('warns on the second consecutive silent cycle', () => {
    const tracker = createMeshtasticPostConfigureSilenceTracker();
    expect(silentCycle(tracker)).toBe(false);
    expect(silentCycle(tracker)).toBe(true);
  });

  it('warns only once per session', () => {
    const tracker = createMeshtasticPostConfigureSilenceTracker();
    silentCycle(tracker);
    expect(silentCycle(tracker)).toBe(true);
    expect(silentCycle(tracker)).toBe(false);
    expect(silentCycle(tracker)).toBe(false);
  });

  it('resets the streak when live data arrives after configure', () => {
    const tracker = createMeshtasticPostConfigureSilenceTracker();
    silentCycle(tracker);
    tracker.markConfigured();
    tracker.markData();
    expect(tracker.noteDead()).toBe(false);
    expect(silentCycle(tracker)).toBe(false);
    expect(silentCycle(tracker)).toBe(true);
  });

  it('ignores data that arrives before configure completes', () => {
    const tracker = createMeshtasticPostConfigureSilenceTracker();
    silentCycle(tracker);
    tracker.markData();
    expect(silentCycle(tracker)).toBe(true);
  });

  it('does not count a dead link that never reached configured', () => {
    const tracker = createMeshtasticPostConfigureSilenceTracker();
    silentCycle(tracker);
    expect(tracker.noteDead()).toBe(false);
    expect(silentCycle(tracker)).toBe(true);
  });

  it('reset allows the hint again after a manual reconnect', () => {
    const tracker = createMeshtasticPostConfigureSilenceTracker();
    silentCycle(tracker);
    expect(silentCycle(tracker)).toBe(true);
    tracker.reset();
    expect(silentCycle(tracker)).toBe(false);
    expect(silentCycle(tracker)).toBe(true);
  });
});
