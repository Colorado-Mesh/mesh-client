import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PN_HOSTING_POLICY,
  parsePnHostingPolicy,
  sanitizePnHostingPolicy,
  validatePnHostingPolicy,
} from '@/shared/pnHostingPolicy';

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

  it('falls back to defaults when semantic validation fails', () => {
    expect(
      parsePnHostingPolicy({
        peering_cost: 30,
        max_peering_cost: 26,
      }),
    ).toEqual(DEFAULT_PN_HOSTING_POLICY);
  });

  it('rejects peering_cost above max', () => {
    expect(
      validatePnHostingPolicy({
        ...DEFAULT_PN_HOSTING_POLICY,
        peering_cost: 30,
        max_peering_cost: 26,
      }),
    ).toBe('peering_cost_exceeds_max');
  });

  it('rejects bad static peer hashes', () => {
    const err = validatePnHostingPolicy({
      ...DEFAULT_PN_HOSTING_POLICY,
      static_peers: ['abcd'],
    });
    expect(err).toMatch(/^static_peer_invalid:/);
  });

  it('sanitize normalizes peers and empty node names', () => {
    const result = sanitizePnHostingPolicy({
      ...DEFAULT_PN_HOSTING_POLICY,
      static_peers: ['  AABBCCDDEEFF00112233445566778899  ', ''],
      node_name: '   ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policy.static_peers).toEqual(['aabbccddeeff00112233445566778899']);
      expect(result.policy.node_name).toBeNull();
    }
  });

  it('sanitize fails for stamp flex above cost', () => {
    const result = sanitizePnHostingPolicy({
      ...DEFAULT_PN_HOSTING_POLICY,
      propagation_stamp_cost: 2,
      propagation_stamp_flex: 5,
    });
    expect(result).toEqual({ ok: false, error: 'stamp_flex_exceeds_cost' });
  });
});
