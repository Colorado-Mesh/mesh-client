import { describe, expect, it } from 'vitest';

import {
  assertMeshtasticShortNameValid,
  MESHTASTIC_SHORT_NAME_MAX_UTF8_BYTES,
  MESHTASTIC_SHORT_NAME_VALIDATION_I18N_KEYS,
  meshtasticShortNameUtf8ByteLength,
  MeshtasticShortNameValidationError,
  truncateMeshtasticShortName,
  validateMeshtasticShortName,
} from './meshtasticShortNameLimits';

describe('meshtasticShortNameUtf8ByteLength', () => {
  it('counts ASCII as one byte per character', () => {
    expect(meshtasticShortNameUtf8ByteLength('ABCD')).toBe(4);
  });

  it('counts a 4-byte emoji as four bytes', () => {
    expect(meshtasticShortNameUtf8ByteLength('🐘')).toBe(4);
  });

  it('counts two emojis as eight bytes', () => {
    expect(meshtasticShortNameUtf8ByteLength('🐘👀')).toBe(8);
  });
});

describe('truncateMeshtasticShortName', () => {
  it('keeps four ASCII characters', () => {
    expect(truncateMeshtasticShortName('ABCD')).toBe('ABCD');
  });

  it('truncates fifth ASCII character', () => {
    expect(truncateMeshtasticShortName('ABCDE')).toBe('ABCD');
  });

  it('keeps a single 4-byte emoji', () => {
    expect(truncateMeshtasticShortName('🐘')).toBe('🐘');
  });

  it('truncates a second emoji that would exceed the byte budget', () => {
    expect(truncateMeshtasticShortName('🐘👀')).toBe('🐘');
  });

  it('allows mixed ASCII within the byte budget', () => {
    expect(truncateMeshtasticShortName('A🐘')).toBe('A');
  });

  it('returns empty for empty input', () => {
    expect(truncateMeshtasticShortName('')).toBe('');
  });
});

describe('validateMeshtasticShortName', () => {
  it('accepts empty string', () => {
    expect(validateMeshtasticShortName('')).toBeNull();
  });

  it('accepts four ASCII characters', () => {
    expect(validateMeshtasticShortName('ABCD')).toBeNull();
  });

  it('accepts a single 4-byte emoji', () => {
    expect(validateMeshtasticShortName('🐘')).toBeNull();
  });

  it('rejects combined text over the byte budget', () => {
    expect(validateMeshtasticShortName('🐘👀')).toBe('tooLong');
  });

  it('rejects fifth ASCII character', () => {
    expect(validateMeshtasticShortName('ABCDE')).toBe('tooLong');
  });
});

describe('assertMeshtasticShortNameValid', () => {
  it('throws MeshtasticShortNameValidationError with i18n key for invalid input', () => {
    expect(() => {
      assertMeshtasticShortNameValid('🐘👀');
    }).toThrow(MeshtasticShortNameValidationError);
    try {
      assertMeshtasticShortNameValid('🐘👀');
    } catch (err) {
      expect(err).toBeInstanceOf(MeshtasticShortNameValidationError);
      expect((err as MeshtasticShortNameValidationError).i18nKey).toBe(
        MESHTASTIC_SHORT_NAME_VALIDATION_I18N_KEYS.tooLong,
      );
    }
  });

  it('does not throw for valid short names', () => {
    expect(() => {
      assertMeshtasticShortNameValid('ABCD');
    }).not.toThrow();
  });
});

describe('MESHTASTIC_SHORT_NAME_MAX_UTF8_BYTES', () => {
  it('matches firmware limit', () => {
    expect(MESHTASTIC_SHORT_NAME_MAX_UTF8_BYTES).toBe(4);
  });
});
