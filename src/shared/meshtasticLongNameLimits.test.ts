import { describe, expect, it } from 'vitest';

import {
  assertMeshtasticLongNameValid,
  MESHTASTIC_LONG_NAME_MAX_UTF8_BYTES,
  meshtasticLongNameUtf8ByteLength,
  MeshtasticLongNameValidationError,
  truncateMeshtasticLongName,
  validateMeshtasticLongName,
} from './meshtasticLongNameLimits';

describe('meshtasticLongNameLimits', () => {
  it('uses the firmware 2.8 budget of 24 bytes', () => {
    expect(MESHTASTIC_LONG_NAME_MAX_UTF8_BYTES).toBe(24);
  });

  it('accepts exactly 24 ASCII bytes and rejects 25', () => {
    expect(validateMeshtasticLongName('a'.repeat(24))).toBeNull();
    expect(validateMeshtasticLongName('a'.repeat(25))).toBe('tooLong');
    expect(validateMeshtasticLongName('')).toBeNull();
  });

  it('counts multibyte characters by UTF-8 length', () => {
    expect(meshtasticLongNameUtf8ByteLength('é')).toBe(2);
    expect(meshtasticLongNameUtf8ByteLength('🐘')).toBe(4);
    expect(validateMeshtasticLongName('🐘'.repeat(6))).toBeNull();
    expect(validateMeshtasticLongName(`${'🐘'.repeat(6)}a`)).toBe('tooLong');
  });

  it('truncates on codepoint boundaries without splitting an emoji', () => {
    const truncated = truncateMeshtasticLongName(`${'a'.repeat(22)}🐘`);
    expect(truncated).toBe('a'.repeat(22));
    expect(truncateMeshtasticLongName('Node with a fairly long display name')).toBe(
      'Node with a fairly long ',
    );
    expect(truncateMeshtasticLongName('short')).toBe('short');
  });

  it('assert throws an error carrying the i18n key', () => {
    expect(() => {
      assertMeshtasticLongNameValid('a'.repeat(25));
    }).toThrow(MeshtasticLongNameValidationError);
    try {
      assertMeshtasticLongNameValid('a'.repeat(25));
    } catch (err) {
      expect((err as MeshtasticLongNameValidationError).i18nKey).toBe(
        'radioPanel.validationLongNameTooLong',
      );
    }
    expect(() => {
      assertMeshtasticLongNameValid('ok');
    }).not.toThrow();
  });
});
