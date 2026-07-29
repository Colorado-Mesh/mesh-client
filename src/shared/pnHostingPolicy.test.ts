import { describe, expect, it } from 'vitest';

import { DEFAULT_PN_HOSTING_POLICY, parsePnHostingPolicy } from '@/shared/pnHostingPolicy';

describe('pnHostingPolicy', () => {
  it('returns defaults for empty input', () => {
    expect(parsePnHostingPolicy(undefined)).toEqual(DEFAULT_PN_HOSTING_POLICY);
    expect(parsePnHostingPolicy({})).toEqual(DEFAULT_PN_HOSTING_POLICY);
  });

  it('parses known fields', () => {
    const parsed = parsePnHostingPolicy({
      peering_cost: 20,
      max_peering_cost: 30,
      autopeer: false,
      static_peers: ['aabbccddeeff00112233445566778899'],
      node_name: 'Hub',
    });
    expect(parsed.peering_cost).toBe(20);
    expect(parsed.max_peering_cost).toBe(30);
    expect(parsed.autopeer).toBe(false);
    expect(parsed.static_peers).toEqual(['aabbccddeeff00112233445566778899']);
    expect(parsed.node_name).toBe('Hub');
  });
});
