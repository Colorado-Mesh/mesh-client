import { describe, expect, it } from 'vitest';

import {
  isTranslationLanguage,
  normalizeTranslationLanguage,
  translationPath,
} from './translationLanguages';

describe('translation languages', () => {
  it('normalizes regional read languages', () => {
    expect(normalizeTranslationLanguage('pt-BR')).toBe('pt');
    expect(normalizeTranslationLanguage('ZH_hans')).toBe('zh');
  });
  it('rejects arbitrary language codes', () => {
    expect(isTranslationLanguage('../en')).toBe(false);
    expect(isTranslationLanguage('fr')).toBe(true);
  });
  it('routes direct, pivot and same-language paths', () => {
    expect(translationPath('fr', 'de')).toEqual(['fr-en', 'en-de']);
    expect(translationPath('en', 'fr')).toEqual(['en-fr']);
    expect(translationPath('fr', 'fr')).toEqual([]);
  });
});
