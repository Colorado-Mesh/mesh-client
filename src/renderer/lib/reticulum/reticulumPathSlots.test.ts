import { describe, expect, it } from 'vitest';

import {
  bestReticulumRrcPathSlot,
  type ReticulumPathSlot,
  RRC_MAX_CONNECT_HOPS,
} from '@/renderer/lib/reticulum/reticulumPathSlots';

function slot(
  partial: Partial<ReticulumPathSlot> & Pick<ReticulumPathSlot, 'active'>,
): ReticulumPathSlot {
  return {
    hops: null,
    via_hash: null,
    interface: null,
    interface_id: null,
    medium: null,
    timestamp: null,
    expires: null,
    expired: false,
    ...partial,
  };
}

describe('bestReticulumRrcPathSlot', () => {
  it('includes RF slots when they are within the hop cap', () => {
    const rf = slot({ active: true, hops: 3, medium: 'rf', interface: 'RNode' });
    expect(bestReticulumRrcPathSlot([rf])).toBe(rf);
  });

  it('picks the lowest-hop live slot within the RRC cap', () => {
    const high = slot({
      active: true,
      hops: 42,
      medium: 'network',
      interface: 'RNS DFW Central',
    });
    const low = slot({
      active: false,
      hops: 2,
      medium: 'network',
      interface: 'Ratspeak',
    });
    expect(bestReticulumRrcPathSlot([high, low])).toBe(low);
  });

  it('ignores expired slots and paths above the RRC hop cap', () => {
    const tooFar = slot({ active: true, hops: RRC_MAX_CONNECT_HOPS + 1, medium: 'network' });
    const expired = slot({
      active: true,
      hops: 1,
      medium: 'network',
      expired: true,
    });
    const ok = slot({ active: false, hops: 3, medium: 'network', interface: 'Ratspeak' });
    expect(bestReticulumRrcPathSlot([tooFar, expired, ok])).toBe(ok);
  });
});
