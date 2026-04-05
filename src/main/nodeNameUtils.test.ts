import { describe, expect, it } from 'vitest';

import {
  isDefaultShortName,
  isPlaceholderLongName,
  meshtasticShortNameAfterClearingDefault,
  preferNonEmptyTrimmedString,
} from '../shared/nodeNameUtils';

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
