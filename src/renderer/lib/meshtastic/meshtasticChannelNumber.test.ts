import { Types } from '@meshtastic/core';
import { describe, expect, it } from 'vitest';

import { MESHTASTIC_PRIMARY_CHANNEL, toMeshtasticChannelNumber } from './meshtasticChannelNumber';

describe('toMeshtasticChannelNumber', () => {
  it('maps slot indexes onto the ChannelNumber enum', () => {
    expect(toMeshtasticChannelNumber(0)).toBe(Types.ChannelNumber.Primary);
    expect(toMeshtasticChannelNumber(3)).toBe(Types.ChannelNumber.Channel3);
    expect(toMeshtasticChannelNumber(7)).toBe(Types.ChannelNumber.Admin);
  });

  it('exposes the primary channel constant', () => {
    expect(MESHTASTIC_PRIMARY_CHANNEL).toBe(0);
  });
});
