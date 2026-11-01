import { beforeEach, describe, expect, it } from 'vitest';

import { getTextDirection } from '../locales/languages';
import { applyDocumentDirection } from './documentDirection';
import i18n from './i18n';

describe('document direction (RTL plumbing)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it.each([
    ['ar', 'rtl'],
    ['he', 'rtl'],
    ['ar-EG', 'rtl'],
    ['en', 'ltr'],
    ['de', 'ltr'],
  ] as const)('getTextDirection(%s) → %s', (locale, dir) => {
    expect(getTextDirection(locale)).toBe(dir);
  });

  it.each([
    ['ar', 'rtl'],
    ['he', 'rtl'],
    ['en', 'ltr'],
    ['de', 'ltr'],
  ] as const)('applyDocumentDirection sets dir/lang for %s → %s', (locale, dir) => {
    applyDocumentDirection(locale);
    expect(document.documentElement.dir).toBe(dir);
    expect(document.documentElement.lang).toBe(locale);
  });

  it('applyDocumentDirection tolerates missing codes', () => {
    applyDocumentDirection(undefined);
    expect(document.documentElement.dir).toBe('ltr');
  });
});
