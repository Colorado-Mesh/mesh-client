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
});
