import { afterEach, describe, expect, it, vi } from 'vitest';

import { markLaunchMilestone, resetLaunchMilestonesForTests } from './launchTimings';
import { clearRendererTimings, getRendererTimingsSnapshot } from './rendererTimings';

describe('launchTimings', () => {
  afterEach(() => {
    resetLaunchMilestonesForTests();
    clearRendererTimings();
    vi.restoreAllMocks();
  });

  it('records each milestone once with launch: prefix', () => {
    vi.spyOn(performance, 'now').mockReturnValue(42.5);
    markLaunchMilestone('secretsReady');
    markLaunchMilestone('secretsReady');
    markLaunchMilestone('pruneDone');
    const names = getRendererTimingsSnapshot().samples.map((s) => s.name);
    expect(names.filter((n) => n === 'launch:secretsReady')).toHaveLength(1);
    expect(names).toContain('launch:pruneDone');
    expect(
      getRendererTimingsSnapshot().samples.find((s) => s.name === 'launch:secretsReady'),
    ).toMatchObject({ durationMs: 42.5 });
  });
});
