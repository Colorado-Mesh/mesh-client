import { describe, expect, it } from 'vitest';

import { nodesExemptFromPositionPrune } from './incidentTrackExemption';

describe('nodesExemptFromPositionPrune', () => {
  it('exempts senders of open and acked incidents', () => {
    const result = nodesExemptFromPositionPrune([
      { status: 'open', senderId: '!aaaa0001', lat: 39.7, lon: -105 },
      { status: 'acked', senderId: '!aaaa0002' },
      { status: 'resolved', senderId: '!aaaa0003', lat: 40, lon: -104 },
    ]);
    expect([...result].sort()).toEqual(['!aaaa0001', '!aaaa0002']);
  });

  it('ignores empty or whitespace sender ids and unknown statuses', () => {
    const result = nodesExemptFromPositionPrune([
      { status: 'open', senderId: '' },
      { status: 'acked', senderId: '   ' },
      { status: 'drill', senderId: '!bbbb0001' },
    ]);
    expect(result.size).toBe(0);
  });

  it('dedupes a sender with multiple active incidents', () => {
    const result = nodesExemptFromPositionPrune([
      { status: 'open', senderId: '!cccc0001' },
      { status: 'acked', senderId: ' !cccc0001 ' },
    ]);
    expect([...result]).toEqual(['!cccc0001']);
  });

  it('returns an empty set for no incidents', () => {
    expect(nodesExemptFromPositionPrune([]).size).toBe(0);
  });
});
