import { describe, expect, it } from 'vitest';

import {
  reticulumDmPathStatusFromProbe,
  seedReticulumDmPathStatus,
} from './reticulumDmPathReachability';

describe('reticulumDmPathReachability', () => {
  it('seeds reachable when hops are known', () => {
    expect(seedReticulumDmPathStatus(0)).toBe('reachable');
    expect(seedReticulumDmPathStatus(2)).toBe('reachable');
    expect(seedReticulumDmPathStatus(null)).toBe('idle');
    expect(seedReticulumDmPathStatus(undefined)).toBe('idle');
  });

  it('maps probe ok to reachable and failure to unreachable', () => {
    expect(reticulumDmPathStatusFromProbe(true)).toBe('reachable');
    expect(reticulumDmPathStatusFromProbe(false)).toBe('unreachable');
  });
});
