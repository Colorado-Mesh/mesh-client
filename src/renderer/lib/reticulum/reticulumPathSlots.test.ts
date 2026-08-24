import { describe, expect, it } from 'vitest';

import {
  bestReticulumRrcNetworkPathSlot,
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

describe('bestReticulumRrcNetworkPathSlot', () => {
  it('picks lowest-hop live network slot within RRC limit', () => {
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
    expect(bestReticulumRrcNetworkPathSlot([high, low])).toBe(low);
  });

  it('ignores RF slots and paths above the RRC hop cap', () => {
    const rf = slot({ active: true, hops: 1, medium: 'rf', interface: 'RNode' });
    const tooFar = slot({ active: true, hops: RRC_MAX_CONNECT_HOPS + 1, medium: 'network' });
    const ok = slot({ active: false, hops: 3, medium: 'network', interface: 'Ratspeak' });
    expect(bestReticulumRrcNetworkPathSlot([rf, tooFar, ok])).toBe(ok);
  });

  it('returns null when no viable network slot exists', () => {
    expect(
      bestReticulumRrcNetworkPathSlot([
        slot({ active: true, hops: 12, medium: 'network', expired: true }),
      ]),
    ).toBeNull();
  });
});

describe('bestReticulumRrcPathSlot', () => {
  it('includes RF slots when they are within the hop cap', () => {
    const rf = slot({ active: true, hops: 3, medium: 'rf', interface: 'RNode' });
    expect(bestReticulumRrcPathSlot([rf])).toBe(rf);
  });
});
