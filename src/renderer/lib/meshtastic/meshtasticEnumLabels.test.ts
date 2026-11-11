import { describe, expect, it } from 'vitest';

import {
  meshtasticModemPresetLabel,
  meshtasticModemPresetSelectOptions,
  meshtasticRegionLabel,
  meshtasticRegionSelectOptions,
} from './meshtasticEnumLabels';

/** Translator that has no bundled strings, so labels fall back to humanized enum names. */
/** Translator with no bundled strings, so labels use humanized enum names. */
const untranslated = (_key: string, options?: Record<string, unknown>): string =>
  typeof options?.defaultValue === 'string' ? options.defaultValue : '';

/** Translator that returns a supplied override for one key. */
/** Translator that overrides region keys and falls back for the rest. */
const translated = (key: string, options?: Record<string, unknown>): string =>
  key.includes('regions') ? 'Translated region' : untranslated(key, options);

describe('meshtasticRegionLabel', () => {
  it('returns the numeric string for unknown region codes', () => {
    expect(meshtasticRegionLabel(99, untranslated)).toBe('99');
  });

  it('falls back to a humanized enum name when the key is untranslated', () => {
    const label = meshtasticRegionLabel(0, untranslated);
    expect(label).not.toBe('0');
    expect(label).toMatch(/^[A-Z]/);
  });

  it('prefers the translated label', () => {
    expect(meshtasticRegionLabel(0, translated)).toBe('Translated region');
  });
});

describe('meshtasticModemPresetLabel', () => {
  it('returns the numeric string for unknown preset codes', () => {
    expect(meshtasticModemPresetLabel(9999, untranslated)).toBe('9999');
  });

  it('returns a non-empty humanized label for a known preset', () => {
    const label = meshtasticModemPresetLabel(0, untranslated);
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe('0');
  });
});

describe('meshtasticRegionSelectOptions', () => {
  it('returns a de-duplicated list of numeric values with string labels', () => {
    const opts = meshtasticRegionSelectOptions(untranslated);
    expect(opts.length).toBeGreaterThan(0);
    for (const option of opts) {
      expect(typeof option.value).toBe('number');
      expect(typeof option.label).toBe('string');
      expect(option.label.length).toBeGreaterThan(0);
    }
    const values = opts.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('meshtasticModemPresetSelectOptions', () => {
  it('returns numeric values with string labels', () => {
    const opts = meshtasticModemPresetSelectOptions(untranslated);
    expect(opts.length).toBeGreaterThan(0);
    for (const option of opts) {
      expect(typeof option.value).toBe('number');
      expect(typeof option.label).toBe('string');
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});
