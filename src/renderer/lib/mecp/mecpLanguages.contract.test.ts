import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getCachedMecpLanguage, loadMecpLanguage, mecpLanguageForAppLocale } from './mecpMessages';

const LANG_DIR = join(__dirname, 'languages');
const MESSAGES_SRC = join(__dirname, 'mecpMessages.ts');

/**
 * Image of `mecpLanguageForAppLocale`: every 2-letter base, a region tag, and the
 * Chinese/Portuguese special cases. Unmapped bases fall through to `en`.
 */
function mecpLanguageImage(): Set<string> {
  const image = new Set<string>();
  const alphabet: string[] = [];
  for (let code = 97; code <= 122; code++) alphabet.push(String.fromCharCode(code));
  for (const a of alphabet) {
    for (const b of alphabet) {
      const base = `${a}${b}`;
      image.add(mecpLanguageForAppLocale(base));
      image.add(mecpLanguageForAppLocale(`${base}-${base.toUpperCase()}`));
    }
  }
  for (const sample of ['zh-hans', 'zh-hant', 'zh-cn', 'zh-tw', 'zh-CN', 'zh-TW', 'pt-BR', '']) {
    image.add(mecpLanguageForAppLocale(sample));
  }
  return image;
}

function loaderKeysFromSource(src: string): string[] {
  const start = src.indexOf('const LANGUAGE_LOADERS');
  const end = src.indexOf('export function mecpLanguageForAppLocale');
  if (start < 0 || end < start) {
    throw new Error('LANGUAGE_LOADERS block not found');
  }
  const block = src.slice(start, end);
  const keys: string[] = [];
  for (const match of block.matchAll(/^\s*'([^']+)'\s*:/gm)) {
    keys.push(match[1]);
  }
  for (const match of block.matchAll(/^\s*([a-z]{2})\s*:/gm)) {
    keys.push(match[1]);
  }
  if (keys.length === 0) throw new Error('no LANGUAGE_LOADERS keys parsed');
  return keys;
}

function assertPackShape(filePath: string): void {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  expect(parsed).toEqual(expect.any(Object));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${filePath} is not an object`);
  }
  expect(Object.keys(parsed).sort()).toEqual(['categories', 'codes']);
  const categories: unknown = Reflect.get(parsed, 'categories');
  const codes: unknown = Reflect.get(parsed, 'codes');
  expect(categories).toEqual(expect.any(Object));
  expect(codes).toEqual(expect.any(Object));
  if (typeof categories !== 'object' || categories === null || Array.isArray(categories)) {
    throw new Error(`${filePath} categories`);
  }
  if (typeof codes !== 'object' || codes === null || Array.isArray(codes)) {
    throw new Error(`${filePath} codes`);
  }
  expect(Object.keys(categories).length).toBeGreaterThan(0);
  expect(Object.keys(codes).length).toBeGreaterThan(0);
  for (const entry of Object.values(categories)) {
    expect(entry).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        icon: expect.any(String),
      }),
    );
  }
  for (const text of Object.values(codes)) {
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  }
}

describe('MECP language pack contract', () => {
  const loaderKeys = loaderKeysFromSource(readFileSync(MESSAGES_SRC, 'utf8'));

  it('keeps every loader key inside mecpLanguageForAppLocale', () => {
    const image = mecpLanguageImage();
    for (const key of loaderKeys) {
      expect(image.has(key), key).toBe(true);
    }
    // fa/no/sk/sr/sv are not in the mapper's range, so their packs are not shipped.
    for (const unreachable of ['fa', 'no', 'sk', 'sr', 'sv']) {
      expect(mecpLanguageForAppLocale(unreachable)).toBe('en');
      expect(loaderKeys).not.toContain(unreachable);
      expect(existsSync(join(LANG_DIR, `${unreachable}.json`))).toBe(false);
    }
    // Supported app locale `zh` maps to zh-cn. zh-tw stays reachable for zh-TW / zh-Hant.
    expect(mecpLanguageForAppLocale('zh')).toBe('zh-cn');
    expect(mecpLanguageForAppLocale('zh-TW')).toBe('zh-tw');
    expect(mecpLanguageForAppLocale('zh-Hant')).toBe('zh-tw');
    expect(loaderKeys).toContain('zh-cn');
    expect(loaderKeys).toContain('zh-tw');
    expect(loaderKeys).not.toContain('en');
  });

  it('ships codes and categories and nothing else', async () => {
    const files = readdirSync(LANG_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort();
    expect(files).toEqual([...loaderKeys.map((key) => `${key}.json`), 'en.json'].sort());

    for (const name of files) {
      assertPackShape(join(LANG_DIR, name));
    }

    const english = getCachedMecpLanguage('en');
    expect(english.categories.M.name).toBe('Medical');
    expect(english.codes.M01).toBe('Injury');

    for (const key of loaderKeys) {
      const loaded = await loadMecpLanguage(key);
      expect(loaded).not.toBe(english);
      expect(Object.keys(loaded.categories).length).toBeGreaterThan(0);
      expect(Object.keys(loaded.codes).length).toBeGreaterThan(0);
      expect(loaded.codes.M01.length).toBeGreaterThan(0);
    }
  });
});
