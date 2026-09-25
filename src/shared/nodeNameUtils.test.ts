import { describe, expect, it } from 'vitest';

import {
  formatMeshtasticNodeId,
  formatMeshtasticNodeIdHex,
  isDefaultShortName,
  isMeshtasticBroadcastNodeNum,
  isPlaceholderLongName,
  meshtasticNodeIdMatchesHexQuery,
  meshtasticNodeLacksDisplayIdentity,
  meshtasticShortNameAfterClearingDefault,
  preferNonEmptyTrimmedString,
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

  it('does not match every node when query is only zeros', () => {
    expect(meshtasticNodeIdMatchesHexQuery(0x0bcd5737, '0')).toBe(true);
    expect(meshtasticNodeIdMatchesHexQuery(0xdeadbeef, '0')).toBe(false);
    expect(meshtasticNodeIdMatchesHexQuery(0x10000000, '0')).toBe(true);
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

describe('preferNonEmptyTrimmedString', () => {
  it('uses fallback when preferred is undefined', () => {
    expect(preferNonEmptyTrimmedString(undefined, 'keep')).toBe('keep');
  });

  it('uses fallback when preferred is empty or whitespace', () => {
    expect(preferNonEmptyTrimmedString('', 'keep')).toBe('keep');
    expect(preferNonEmptyTrimmedString('   ', 'keep')).toBe('keep');
  });

  it('uses trimmed preferred when non-empty', () => {
    expect(preferNonEmptyTrimmedString('  Alice  ', 'keep')).toBe('Alice');
  });

  it('treats empty string as undefined', () => {
    expect(preferNonEmptyTrimmedString('', 'fallback')).toBe('fallback');
  });

  it('treats placeholder as empty when nodeId provided', () => {
    expect(preferNonEmptyTrimmedString('!abcd1234', 'fallback', { nodeId: 0xabcd1234 })).toBe(
      'fallback',
    );
  });

  it('treats placeholder case-insensitively', () => {
    expect(preferNonEmptyTrimmedString('!ABCD1234', 'fallback', { nodeId: 0xabcd1234 })).toBe(
      'fallback',
    );
  });

  it('keeps real name even with nodeId option', () => {
    expect(preferNonEmptyTrimmedString("Bob's Radio", 'fallback', { nodeId: 0xabcd1234 })).toBe(
      "Bob's Radio",
    );
  });

  it('ignores nodeId option when preferred is empty', () => {
    expect(preferNonEmptyTrimmedString('', 'fallback', { nodeId: 0xabcd1234 })).toBe('fallback');
  });
});

describe('isPlaceholderLongName', () => {
  it('is true for client !xxxxxxxx placeholder', () => {
    expect(isPlaceholderLongName('!abcd1234', 0xabcd1234)).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isPlaceholderLongName('!ABCD1234', 0xabcd1234)).toBe(true);
  });

  it('is false for a user long name', () => {
    expect(isPlaceholderLongName("Bob's Radio", 0xabcd1234)).toBe(false);
  });
});

describe('isDefaultShortName', () => {
  it('is true when short name is last 4 hex of node id', () => {
    expect(isDefaultShortName('1234', 0xabcd1234)).toBe(true);
  });

  it('is false for a custom short name', () => {
    expect(isDefaultShortName('Bob', 0xabcd1234)).toBe(false);
  });

  it('is false for empty short name', () => {
    expect(isDefaultShortName('', 0xabcd1234)).toBe(false);
  });
});

describe('meshtasticShortNameAfterClearingDefault', () => {
  it('clears default short when long name is real', () => {
    expect(meshtasticShortNameAfterClearingDefault("Alice's node", '1234', 0xabcd1234)).toBe('');
  });

  it('keeps default short when long name is still placeholder', () => {
    expect(meshtasticShortNameAfterClearingDefault('!abcd1234', '1234', 0xabcd1234)).toBe('1234');
  });

  it('keeps a non-default short name', () => {
    expect(meshtasticShortNameAfterClearingDefault('Long name here', 'ABCD', 0xabcd1234)).toBe(
      'ABCD',
    );
  });
});
