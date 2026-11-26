import { describe, expect, it } from 'vitest';

import { meshcomTransportBadgeText } from './meshcomTransportBadge';

describe('meshcomTransportBadgeText', () => {
  it('returns GW for network and RF otherwise', () => {
    expect(meshcomTransportBadgeText('network')).toBe('GW');
    expect(meshcomTransportBadgeText('rf')).toBe('RF');
    expect(meshcomTransportBadgeText('mqtt')).toBe('RF');
    expect(meshcomTransportBadgeText(undefined)).toBe('RF');
  });
});
