import { describe, expect, it } from 'vitest';

import {
  MAX_ENABLED_INTERFACE_NAMES,
  MAX_INTERFACE_NAME_LEN,
  parseEnabledInterfaceNames,
} from './reticulumInterfaceIssueScope';

describe('parseEnabledInterfaceNames', () => {
  it('accepts an empty array (clear all TCP/TX latches)', () => {
    expect(parseEnabledInterfaceNames([])).toEqual([]);
  });

  it('trims and caps names', () => {
    const long = 'a'.repeat(MAX_INTERFACE_NAME_LEN + 20);
    expect(parseEnabledInterfaceNames([`  Hub One  `, long])).toEqual([
      'Hub One',
      'a'.repeat(MAX_INTERFACE_NAME_LEN),
    ]);
  });

  it('throws on non-array', () => {
    expect(() => parseEnabledInterfaceNames('nope')).toThrow(
      'enabledInterfaceNames must be an array of strings',
    );
  });

  it('throws when non-empty payload has only invalid entries', () => {
    expect(() => parseEnabledInterfaceNames(['', '  ', 42])).toThrow(
      'enabledInterfaceNames must contain at least one non-empty string',
    );
  });

  it('keeps valid entries when mixed with invalid', () => {
    expect(parseEnabledInterfaceNames(['', 'Good', null, '  Also  '])).toEqual(['Good', 'Also']);
  });

  it('caps array length', () => {
    const many = Array.from({ length: MAX_ENABLED_INTERFACE_NAMES + 10 }, (_, i) => `n${i}`);
    expect(parseEnabledInterfaceNames(many)).toHaveLength(MAX_ENABLED_INTERFACE_NAMES);
  });
});
