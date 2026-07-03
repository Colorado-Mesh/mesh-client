import { beforeEach, describe, expect, it } from 'vitest';

import {
  parseBeaconFailIfaceForTests,
  ReticulumSidecarAutoBeaconTracker,
} from './reticulumSidecarAutoBeaconTracker';

describe('ReticulumSidecarAutoBeaconTracker', () => {
  let tracker: ReticulumSidecarAutoBeaconTracker;

  beforeEach(() => {
    tracker = new ReticulumSidecarAutoBeaconTracker();
  });

  it('parses iface from beacon failure stderr', () => {
    expect(parseBeaconFailIfaceForTests('auto: beacon TX failed iface = utun4')).toBe('utun4');
  });

  it('classifies tunnel-only failures', () => {
    tracker.recordFailure('auto: beacon TX failed iface = utun0', false, 1000);
    expect(tracker.getAlert(2000)?.kind).toBe('tunnel_only');
  });

  it('classifies physical interface failures as higher severity', () => {
    tracker.recordFailure('auto: beacon TX failed iface = en0', false, 1000);
    expect(tracker.getAlert(2000)?.kind).toBe('physical_failures');
  });
});
