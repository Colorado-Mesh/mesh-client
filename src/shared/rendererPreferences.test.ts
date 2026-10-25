import { describe, expect, it } from 'vitest';

import {
  explicitResetPreferenceBaselineJson,
  mergeRendererPreferenceEnvelopes,
  parseRendererPreferenceValues,
} from './rendererPreferences';

describe('rendererPreferences envelope helpers', () => {
  it('parses preference values and rejects malformed envelopes', () => {
    expect(
      parseRendererPreferenceValues(
        JSON.stringify({
          legacyAliasesImported: true,
          values: { 'mesh-client:protocol': 'meshcore' },
        }),
      ),
    ).toEqual({ 'mesh-client:protocol': 'meshcore' });
    expect(parseRendererPreferenceValues('{"values":[]}')).toBeNull();
    expect(parseRendererPreferenceValues('{')).toBeNull();
  });

  it('gap-fills missing repaired keys while keeping newer SQLite values', () => {
    const existing = JSON.stringify({
      legacyAliasesImported: true,
      values: {
        'mesh-client:protocol': 'reticulum',
        'mesh-client:fontScale': '1',
      },
    });
    const incoming = JSON.stringify({
      legacyAliasesImported: true,
      values: {
        'mesh-client:protocol': 'meshcore',
        'mesh-client:origin-e2e-marker': 'original profile',
      },
    });
    expect(JSON.parse(mergeRendererPreferenceEnvelopes(existing, incoming))).toEqual({
      legacyAliasesImported: true,
      values: {
        'mesh-client:protocol': 'reticulum',
        'mesh-client:fontScale': '1',
        'mesh-client:origin-e2e-marker': 'original profile',
      },
    });
  });

  it('replaces an empty envelope and preserves an explicit-reset baseline', () => {
    const restored = JSON.stringify({
      legacyAliasesImported: true,
      values: { 'mesh-client:origin-e2e-marker': 'original profile' },
    });
    expect(
      mergeRendererPreferenceEnvelopes(
        JSON.stringify({ legacyAliasesImported: true, values: {} }),
        restored,
      ),
    ).toBe(restored);
    const baseline = explicitResetPreferenceBaselineJson();
    expect(mergeRendererPreferenceEnvelopes(baseline, restored)).toBe(baseline);
  });
});
