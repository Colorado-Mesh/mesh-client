import { describe, expect, it } from 'vitest';

import {
  type SelfFloodAdvertRxLike,
  shouldCoalesceSelfFloodAdvert,
} from './meshcoreRawSelfFloodAdvertCoalesce';

const self = 0xdeadbeef;

function row(
  partial: Partial<SelfFloodAdvertRxLike> & Pick<SelfFloodAdvertRxLike, 'ts'>,
): SelfFloodAdvertRxLike {
  return {
    fromNodeId: self,
    routeTypeString: 'FLOOD',
    payloadTypeString: 'ADVERT',
    ...partial,
  };
}

describe('shouldCoalesceSelfFloodAdvert', () => {
  it('returns true for two self FLOOD ADVERT rows within the window', () => {
    const last = row({ ts: 1000 });
    const next = row({ ts: 4000 });
    expect(shouldCoalesceSelfFloodAdvert(last, next, self, 8000)).toBe(true);
  });

  it('returns false when outside the window', () => {
    const last = row({ ts: 1000 });
    const next = row({ ts: 10_000 });
    expect(shouldCoalesceSelfFloodAdvert(last, next, self, 8000)).toBe(false);
  });

  it('returns false when last is not self', () => {
    const last = row({ ts: 1000, fromNodeId: 0x1111 });
    const next = row({ ts: 4000 });
    expect(shouldCoalesceSelfFloodAdvert(last, next, self, 8000)).toBe(false);
  });

  it('returns false when payload is not ADVERT', () => {
    const last = row({ ts: 1000 });
    const next = { ...row({ ts: 4000 }), payloadTypeString: 'TXT_MSG' as const };
    expect(shouldCoalesceSelfFloodAdvert(last, next, self, 8000)).toBe(false);
  });

  it('returns false when myNodeId is 0', () => {
    const last = row({ ts: 1000 });
    const next = row({ ts: 4000 });
    expect(shouldCoalesceSelfFloodAdvert(last, next, 0, 8000)).toBe(false);
  });
});
