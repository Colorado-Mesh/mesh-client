import { describe, expect, it } from 'vitest';

import { parseAnnounceActivityRows } from './reticulumIdentityActivityStore';

describe('parseAnnounceActivityRows', () => {
  it('parses single aspect announce payload', () => {
    const rows = parseAnnounceActivityRows({
      destination_hash: 'abc123',
      aspect: 'lxmf.delivery',
      identity_hash: 'id99',
      hops: 2,
      last_seen: 1700,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      destination_hash: 'abc123',
      aspect: 'lxmf.delivery',
      identity_hash: 'id99',
      hops: 2,
      last_seen: 1700,
    });
  });

  it('expands aspects array', () => {
    const rows = parseAnnounceActivityRows({
      destination_hash: 'peer1',
      aspects: ['nomadnetwork.node', 'lxmf.delivery'],
    });
    expect(rows.map((r) => r.aspect)).toEqual(['nomadnetwork.node', 'lxmf.delivery']);
  });

  it('parses batched announces array payload', () => {
    const rows = parseAnnounceActivityRows({
      announces: [
        { destination_hash: 'aaa', hops: 1 },
        { destination_hash: 'bbb', display_name: 'Bob', hops: 2 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.destination_hash)).toEqual(['aaa', 'bbb']);
  });
});
