import { describe, expect, it } from 'vitest';

import { meshtasticComputedRfHopsAway } from './meshtasticRfHops';

describe('meshtasticComputedRfHopsAway', () => {
  it('returns hopStart minus hopLimit on RF when valid', () => {
    expect(meshtasticComputedRfHopsAway({ hopStart: 7, hopLimit: 4, viaMqtt: false })).toBe(3);
  });

  it('returns undefined for MQTT packets', () => {
    expect(
      meshtasticComputedRfHopsAway({ hopStart: 7, hopLimit: 4, viaMqtt: true }),
    ).toBeUndefined();
  });

  it('returns undefined when hopStart is zero', () => {
    expect(meshtasticComputedRfHopsAway({ hopStart: 0, hopLimit: 0 })).toBeUndefined();
  });

  it('returns undefined when hopLimit exceeds hopStart', () => {
    expect(meshtasticComputedRfHopsAway({ hopStart: 3, hopLimit: 5 })).toBeUndefined();
  });
});
