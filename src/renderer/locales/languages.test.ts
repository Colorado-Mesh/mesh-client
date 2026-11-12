import { describe, expect, it } from 'vitest';

import { isSupportedLocale, resolveAppLocale, SUPPORTED_LANGUAGES } from './languages';

describe('isSupportedLocale', () => {
  it.each(SUPPORTED_LANGUAGES.map((language) => language.code))(
    'accepts supported locale %s',
    (code) => {
      expect(isSupportedLocale(code)).toBe(true);
    },
  );

  it.each([undefined, null, '', 'ko-KR', 'en-US', 'ko_KR', 'xx', 42, {}, []] as const)(
    'rejects %j',
    (value) => {
      expect(isSupportedLocale(value)).toBe(false);
    },
  );
});

describe('resolveAppLocale', () => {
  it.each(['en', 'de', 'ko', 'pt-BR'] as const)('keeps supported locale %s', (code) => {
    expect(resolveAppLocale(code)).toBe(code);
  });

  it.each([undefined, null, '', 'ko-KR', 'en-US', 'ko_KR', 'xx', 42, {}, []] as const)(
    'falls back to English for %j',
    (value) => {
      expect(resolveAppLocale(value)).toBe('en');
    },
  );
});
