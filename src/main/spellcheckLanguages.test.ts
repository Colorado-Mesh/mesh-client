// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { pickSpellCheckerLanguages } from './spellcheckLanguages';

const AVAILABLE = ['de-DE', 'en-GB', 'en-US', 'es-ES', 'fr-FR'];

describe('pickSpellCheckerLanguages', () => {
  it('prefers an exact locale match', () => {
    expect(pickSpellCheckerLanguages(AVAILABLE, 'fr-FR')).toEqual(['fr-FR']);
  });

  it('adds region-prefix matches after the exact locale', () => {
    expect(pickSpellCheckerLanguages(AVAILABLE, 'en-AU')).toEqual(['en-GB', 'en-US']);
  });

  it('falls back to en-US when locale and region do not match', () => {
    expect(pickSpellCheckerLanguages(AVAILABLE, 'ja-JP')).toEqual(['en-US']);
  });

  it('falls back to the first available language when en-US is missing', () => {
    expect(pickSpellCheckerLanguages(['de-DE', 'fr-FR'], 'ja-JP')).toEqual(['de-DE']);
  });

  it('caps the result at three languages', () => {
    const many = ['en-AU', 'en-CA', 'en-GB', 'en-US', 'en-ZA'];
    expect(pickSpellCheckerLanguages(many, 'en-AU')).toEqual(['en-AU', 'en-CA', 'en-GB']);
  });

  it('returns an empty array when no dictionaries are available', () => {
    expect(pickSpellCheckerLanguages([], 'en-US')).toEqual([]);
  });
});
