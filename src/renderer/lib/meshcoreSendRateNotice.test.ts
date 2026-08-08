import { beforeEach, describe, expect, it } from 'vitest';

import {
  isMeshcoreSendTooFast,
  recordMeshcoreSend,
  resetMeshcoreSendRateForTests,
} from './meshcoreSendRateNotice';
import { MESHCORE_FAST_SEND_WARN_INTERVAL_MS } from './timeConstants';

describe('meshcoreSendRateNotice', () => {
  beforeEach(() => {
    resetMeshcoreSendRateForTests();
  });

  it('is not too fast on the first send (no prior send recorded)', () => {
    expect(isMeshcoreSendTooFast(1_000)).toBe(false);
  });

  it('is too fast when a second send happens within the warn interval', () => {
    recordMeshcoreSend(1_000);
    expect(isMeshcoreSendTooFast(1_000 + MESHCORE_FAST_SEND_WARN_INTERVAL_MS - 1)).toBe(true);
  });

  it('is not too fast once the warn interval has elapsed', () => {
    recordMeshcoreSend(1_000);
    expect(isMeshcoreSendTooFast(1_000 + MESHCORE_FAST_SEND_WARN_INTERVAL_MS)).toBe(false);
    expect(isMeshcoreSendTooFast(1_000 + MESHCORE_FAST_SEND_WARN_INTERVAL_MS + 5_000)).toBe(false);
  });

  it('tracks the most recent send for the cadence check', () => {
    recordMeshcoreSend(1_000);
    recordMeshcoreSend(10_000);
    // Measured from the latest send (10_000), not the first.
    expect(isMeshcoreSendTooFast(10_000 + 1_000)).toBe(true);
    expect(isMeshcoreSendTooFast(1_000 + 1_000)).toBe(true);
  });

  it('resetMeshcoreSendRateForTests clears the shared clock', () => {
    recordMeshcoreSend(1_000);
    resetMeshcoreSendRateForTests();
    expect(isMeshcoreSendTooFast(1_500)).toBe(false);
  });
});
