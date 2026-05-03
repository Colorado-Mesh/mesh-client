import { describe, expect, it } from 'vitest';

import { meshtasticNodeLacksDisplayIdentity } from './nodeNameUtils';

describe('meshtasticNodeLacksDisplayIdentity', () => {
  const id = 0xabcd1234;

  it('returns true when node is undefined', () => {
    expect(meshtasticNodeLacksDisplayIdentity(undefined, id)).toBe(true);
  });

  it('returns true when long_name is empty', () => {
    expect(meshtasticNodeLacksDisplayIdentity({ long_name: '' }, id)).toBe(true);
    expect(meshtasticNodeLacksDisplayIdentity({ long_name: '   ' }, id)).toBe(true);
  });

  it('returns true for Meshtastic !xxxxxxxx placeholder', () => {
    expect(meshtasticNodeLacksDisplayIdentity({ long_name: '!abcd1234' }, id)).toBe(true);
  });

  it('returns false for a real long name', () => {
    expect(meshtasticNodeLacksDisplayIdentity({ long_name: 'Alice' }, id)).toBe(false);
  });
});
