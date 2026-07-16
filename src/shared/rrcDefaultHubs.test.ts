import { describe, expect, it } from 'vitest';

import { RRC_DEFAULT_HUBS, RRC_HUB_ASPECT } from './rrcDefaultHubs';

describe('rrcDefaultHubs', () => {
  it('includes Community and Moscow destination hashes', () => {
    expect(RRC_HUB_ASPECT).toBe('rrc.hub');
    expect(RRC_DEFAULT_HUBS).toHaveLength(2);
    expect(RRC_DEFAULT_HUBS.map((h) => h.destinationHash)).toEqual([
      '28c7c1a68c735693aa8e6b8193ed44b2',
      '42a97b1b07147b898f78a610dfbba587',
    ]);
    for (const hub of RRC_DEFAULT_HUBS) {
      expect(hub.destinationHash).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});
