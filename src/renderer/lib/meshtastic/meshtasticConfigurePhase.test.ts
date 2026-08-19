import { describe, expect, it, vi } from 'vitest';

import {
  getMeshtasticConfigurePhase,
  resetMeshtasticConfigurePhaseForTests,
  setMeshtasticConfigurePhase,
  setMeshtasticConfigureProgressHandler,
  touchMeshtasticConfigureProgress,
} from './meshtasticConfigurePhase';

describe('meshtasticConfigurePhase', () => {
  it('keeps progress handler after configure ends so refresh can reset stall timer', () => {
    resetMeshtasticConfigurePhaseForTests();
    const onProgress = vi.fn();
    setMeshtasticConfigureProgressHandler(onProgress);

    setMeshtasticConfigurePhase(true);
    touchMeshtasticConfigureProgress();
    expect(onProgress).toHaveBeenCalledTimes(1);

    setMeshtasticConfigurePhase(false);
    expect(getMeshtasticConfigurePhase()).toBe(false);

    setMeshtasticConfigurePhase(true);
    touchMeshtasticConfigureProgress();
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('does not invoke progress handler when configure phase is inactive', () => {
    resetMeshtasticConfigurePhaseForTests();
    const onProgress = vi.fn();
    setMeshtasticConfigureProgressHandler(onProgress);

    touchMeshtasticConfigureProgress();
    expect(onProgress).not.toHaveBeenCalled();
  });
});
