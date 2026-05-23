import { describe, expect, it } from 'vitest';

import {
  formatMeshtasticNodeId,
  formatMeshtasticNodeIdHex,
  isMeshtasticBroadcastNodeNum,
  meshtasticNodeIdMatchesHexQuery,
  meshtasticNodeLacksDisplayIdentity,
} from './nodeNameUtils';

describe('formatMeshtasticNodeId', () => {
  it('pads leading zeros for canonical 8-digit hex', () => {
    expect(formatMeshtasticNodeIdHex(0x0bcd5737)).toBe('0bcd5737');
    expect(formatMeshtasticNodeId(0x0bcd5737)).toBe('!0bcd5737');
    expect(formatMeshtasticNodeIdHex(0x0aca472c)).toBe('0aca472c');
    expect(formatMeshtasticNodeId(0xabcd1234)).toBe('!abcd1234');
  });

  it('matches hex queries with or without leading zeros', () => {
    const id = 0x0bcd5737;
    expect(meshtasticNodeIdMatchesHexQuery(id, '0bcd5737')).toBe(true);
    expect(meshtasticNodeIdMatchesHexQuery(id, '!0bcd5737')).toBe(true);
    expect(meshtasticNodeIdMatchesHexQuery(id, 'bcd5737')).toBe(true);
    expect(meshtasticNodeIdMatchesHexQuery(id, 'deadbeef')).toBe(false);
  });

  it('identifies Meshtastic broadcast node num', () => {
    expect(isMeshtasticBroadcastNodeNum(0xffffffff)).toBe(true);
    expect(formatMeshtasticNodeId(0xffffffff)).toBe('!ffffffff');
    expect(isMeshtasticBroadcastNodeNum(0xabcd1234)).toBe(false);
  });
});

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
