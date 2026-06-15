import { describe, it, expect } from 'vitest';
import {
  filterMissingKeysToTranslate,
  restorePlaceholders,
  sanitizeLocaleTranslationJsonFileBodyForDisk,
  setDeepLocaleValue,
  stripPlaceholders,
} from './i18n-auto-translate-lib.mjs';

describe('stripPlaceholders / restorePlaceholders', () => {
  it('round-trips compact __PHn__ tokens', () => {
    const en = 'Removing {{current}} of {{total}}…';
    const { stripped, placeholders } = stripPlaceholders(en);
    expect(stripped).toBe('Removing __PH0__ of __PH1__…');
    expect(restorePlaceholders(stripped, placeholders)).toBe(en);
  });

  it('restores spaced MyMemory __ PH n __ tokens', () => {
    const en = 'Removing {{current}} of {{total}}…';
    const { placeholders } = stripPlaceholders(en);
    expect(restorePlaceholders('Removing __ PH0 __ of __ PH 1 __…', placeholders)).toBe(en);
  });

  it('restores offload partial count placeholder', () => {
    const en = 'Offload cancelled after removing {{count}} contacts from radio.';
    const { placeholders } = stripPlaceholders(en);
    expect(
      restorePlaceholders('Cancelled after __ PH0 __ contacts from radio.', placeholders),
    ).toBe('Cancelled after {{count}} contacts from radio.');
  });
});

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

  it('auditIdentical: also includes present keys whose value matches English', () => {
    const enFlat = { a: 'Translate me please', b: 'Flood Advert', c: 'Factory Reset' };
    const existing = { a: 'Bereits übersetzt', b: 'Flood Advert' }; // a translated, b same as EN, c absent
    expect(
      filterMissingKeysToTranslate(Object.keys(enFlat), existing, null, {
        translateAllGaps: false,
        hasGitBaseline: false,
        auditIdentical: true,
        enFlat,
      }),
    ).toEqual(['b', 'c']);
  });

  it('auditIdentical: skips keys that are genuinely translated (value differs from English)', () => {
    const enFlat = { a: 'A', b: 'B', c: 'C' };
    const existing = { a: 'translated-a', b: 'translated-b', c: 'translated-c' };
    expect(
      filterMissingKeysToTranslate(Object.keys(enFlat), existing, null, {
        translateAllGaps: false,
        hasGitBaseline: false,
        auditIdentical: true,
        enFlat,
      }),
    ).toEqual([]);
  });

  it('auditIdentical: skips brand/loanword-only values that are legitimately identical to English', () => {
    const enFlat = { tak: 'TAK', hops: 'Hops:', sentence: 'Flood Advert section' };
    // all three are same as English in this locale
    const existing = { tak: 'TAK', hops: 'Hops:', sentence: 'Flood Advert section' };
    const result = filterMissingKeysToTranslate(Object.keys(enFlat), existing, null, {
      translateAllGaps: false,
      hasGitBaseline: false,
      auditIdentical: true,
      enFlat,
    });
    // TAK and Hops: are pure loanwords — skip; "Flood Advert section" has translatable content
    expect(result).toEqual(['sentence']);
  });

  it('auditIdentical: skips MGRS, Firmware, Router (new SKIP_AUDIT_RE additions)', () => {
    const enFlat = { mgrs: 'MGRS', fw: 'Firmware', router: 'Router' };
    const existing = { mgrs: 'MGRS', fw: 'Firmware', router: 'Router' };
    const result = filterMissingKeysToTranslate(Object.keys(enFlat), existing, null, {
      translateAllGaps: false,
      hasGitBaseline: false,
      auditIdentical: true,
      enFlat,
    });
    // Pure technical/brand terms — none should be re-translated
    expect(result).toEqual([]);
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
