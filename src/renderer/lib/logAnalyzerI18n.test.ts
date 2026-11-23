import { describe, expect, it } from 'vitest';

import en from '@/renderer/locales/en/translation.json';

import {
  LOG_ANALYZER_CATEGORY_LABEL_KEYS,
  LOG_ANALYZER_CATEGORY_RECOMMENDATION_KEYS,
  LOG_ANALYZER_GROUP_RECOMMENDATION_KEYS,
  resolveLogAnalyzerRecommendationKey,
} from './logAnalyzerI18n';

function getByFlatKeyPath(root: unknown, flatKey: string | undefined): unknown {
  if (!flatKey) return undefined;
  let cur: unknown = root;
  for (const part of flatKey.split('.')) {
    if (cur == null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) {
      return undefined;
    }
    // Own-property read only — avoids prototype-chain walks on dynamic keys.
    cur = Object.getOwnPropertyDescriptor(cur, part)?.value;
  }
  return cur;
}

describe('logAnalyzerI18n key maps', () => {
  it('every LOG_ANALYZER_CATEGORY_LABEL_KEYS value exists in en/translation.json', () => {
    for (const [category, key] of Object.entries(LOG_ANALYZER_CATEGORY_LABEL_KEYS)) {
      const value = getByFlatKeyPath(en, key);
      expect(value, `missing label for ${category}: ${key}`).toEqual(expect.any(String));
      expect(String(value).length, `empty label for ${category}: ${key}`).toBeGreaterThan(0);
    }
  });

  it('every LOG_ANALYZER_CATEGORY_RECOMMENDATION_KEYS value exists in en/translation.json', () => {
    for (const [category, key] of Object.entries(LOG_ANALYZER_CATEGORY_RECOMMENDATION_KEYS)) {
      const value = getByFlatKeyPath(en, key);
      expect(value, `missing recommendation for ${category}: ${key}`).toEqual(expect.any(String));
      expect(String(value).length, `empty recommendation for ${category}: ${key}`).toBeGreaterThan(
        0,
      );
    }
  });

  it('every LOG_ANALYZER_GROUP_RECOMMENDATION_KEYS value exists in en/translation.json', () => {
    for (const [group, key] of Object.entries(LOG_ANALYZER_GROUP_RECOMMENDATION_KEYS)) {
      const value = getByFlatKeyPath(en, key);
      expect(value, `missing group recommendation for ${group}: ${key}`).toEqual(
        expect.any(String),
      );
      expect(
        String(value).length,
        `empty group recommendation for ${group}: ${key}`,
      ).toBeGreaterThan(0);
    }
  });

  it('every real finding resolves its own advice instead of the internal-error fallback', () => {
    for (const category of Object.keys(LOG_ANALYZER_CATEGORY_LABEL_KEYS)) {
      expect(LOG_ANALYZER_CATEGORY_RECOMMENDATION_KEYS[category], category).toBeTruthy();
      expect(resolveLogAnalyzerRecommendationKey(category), category).toBe(
        LOG_ANALYZER_CATEGORY_RECOMMENDATION_KEYS[category],
      );
    }
  });

  it('resolveLogAnalyzerRecommendationKey prefers group map then falls back', () => {
    expect(resolveLogAnalyzerRecommendationKey('__test_merged')).toBe(
      'logAnalyzer.recommendationGroups.__test_merged.recommendation',
    );
    expect(resolveLogAnalyzerRecommendationKey('unknown-group')).toBe(
      'logAnalyzer.categories.internal-error.recommendation',
    );
  });
});
