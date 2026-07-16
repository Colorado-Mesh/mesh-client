import { describe, expect, it } from 'vitest';

import { RRC_DEFAULT_HUBS, RRC_HUB_ASPECT } from './rrcDefaultHubs';

describe('rrcDefaultHubs', () => {
  it('has no curated hubs; Favourites are user-starred only', () => {
    expect(RRC_HUB_ASPECT).toBe('rrc.hub');
    expect(RRC_DEFAULT_HUBS).toHaveLength(0);
  });
});
