import { describe, it, expect } from 'vitest';
import {
  filterMissingKeysToTranslate,
  sanitizeLocaleTranslationJsonFileBodyForDisk,
  setDeepLocaleValue,
} from './i18n-auto-translate-lib.mjs';

describe('filterMissingKeysToTranslate', () => {
  const enKeys = ['a', 'b', 'c'];

  it('incremental: only new English keys that are missing locally', () => {
    const existing = { a: 'x' };
    const added = new Set(['b', 'c']);
    expect(
      filterMissingKeysToTranslate(enKeys, existing, added, {
        translateAllGaps: false,
        hasGitBaseline: true,
      }),
    ).toEqual(['b', 'c']);
  });

  it('incremental: skips keys already present locally even if in added set', () => {
    const existing = { b: 'y' };
    const added = new Set(['b', 'c']);
    expect(
      filterMissingKeysToTranslate(enKeys, existing, added, {
        translateAllGaps: false,
        hasGitBaseline: true,
      }),
    ).toEqual(['c']);
  });

  it('translateAllGaps: fills every missing key regardless of added set', () => {
    const existing = { a: 'x' };
    const added = new Set(['b']);
    expect(
      filterMissingKeysToTranslate(enKeys, existing, added, {
        translateAllGaps: true,
        hasGitBaseline: true,
      }),
    ).toEqual(['b', 'c']);
  });

  it('without git baseline: fill all missing keys (cannot restrict to new EN keys)', () => {
    const existing = { a: 'x' };
    expect(
      filterMissingKeysToTranslate(enKeys, existing, null, {
        translateAllGaps: false,
        hasGitBaseline: false,
      }),
    ).toEqual(['b', 'c']);
  });
});

describe('sanitizeLocaleTranslationJsonFileBodyForDisk', () => {
  it('removes NUL, round-trips JSON, and pretty-prints for disk', () => {
    const raw = '{\n  "a": "x"\n}\n\x00';
    const out = sanitizeLocaleTranslationJsonFileBodyForDisk(raw);
    expect(JSON.parse(out)).toEqual({ a: 'x' });
    expect(out).toMatch(/^\{\n/);
  });

  it('strips line/paragraph separators then parses', () => {
    const withSep = `{\u2028"k":1}`;
    const out = sanitizeLocaleTranslationJsonFileBodyForDisk(withSep);
    expect(JSON.parse(out)).toEqual({ k: 1 });
  });
});

describe('setDeepLocaleValue', () => {
  it('writes nested keys on a plain object', () => {
    const obj = { a: { b: 'keep' } };
    setDeepLocaleValue(obj, 'a.c', 'new');
    expect(obj).toEqual({ a: { b: 'keep', c: 'new' } });
  });

  it('creates missing intermediate objects', () => {
    const obj = {};
    setDeepLocaleValue(obj, 'x.y.z', 'v');
    expect(obj).toEqual({ x: { y: { z: 'v' } } });
  });

  it('rejects __proto__ segments', () => {
    const obj = {};
    expect(() => setDeepLocaleValue(obj, '__proto__.polluted', 'x')).toThrow(/Unsafe locale key/);
    expect(obj).toEqual({});
  });

  it('rejects constructor / prototype segments', () => {
    expect(() => setDeepLocaleValue({}, 'a.constructor.foo', 'x')).toThrow(/Unsafe locale key/);
    expect(() => setDeepLocaleValue({}, 'a.prototype.foo', 'x')).toThrow(/Unsafe locale key/);
  });

  it('rejects empty path segments', () => {
    expect(() => setDeepLocaleValue({}, 'a..b', 'x')).toThrow(/empty segment/);
  });
});
