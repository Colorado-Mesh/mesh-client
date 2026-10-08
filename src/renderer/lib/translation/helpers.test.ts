import { describe, expect, it } from 'vitest';

import {
  readsTranslationLanguage,
  skipMessageTranslation,
  translationCacheKey,
  translationMessageKey,
} from './helpers';

describe('translation message rules', () => {
  it.each([
    'hi',
    '👋😀🚀',
    'https://example.org/a https://example.org/b',
    'MECP emergency report with data',
    'geo:39.74,-104.99',
    '[voice:recording with metadata]',
    '[file:document attachment]',
    '{"message":"structured text"}',
    'r:abcd:reaction text',
    'g:gif data with metadata',
    'Weather forecast Hi 22 / Lo 10',
  ])('skips %s', (text) => {
    expect(skipMessageTranslation(text)).toBe(true);
  });
  it('allows prose and normalizes regional reading preferences', () => {
    expect(skipMessageTranslation('Bonjour à tous, comment allez-vous ?')).toBe(false);
    expect(readsTranslationLanguage('pt', ['pt-BR'])).toBe(true);
    expect(readsTranslationLanguage('fr', ['en'])).toBe(false);
  });
  it('keys the in-memory cache by content, target and provider', async () => {
    const key = await translationCacheKey('private message', 'en', 'offline');
    expect(key).toBe(await translationCacheKey('private message', 'en', 'offline'));
    expect(key).not.toContain('private message');
    expect(key).not.toBe(await translationCacheKey('private message', 'fr', 'offline'));
    expect(key).not.toBe(await translationCacheKey('private message', 'en', 'libre'));
    expect(translationMessageKey('hub:a', 'text', 'en')).not.toBe(
      translationMessageKey('hub:b', 'text', 'en'),
    );
  });
});
