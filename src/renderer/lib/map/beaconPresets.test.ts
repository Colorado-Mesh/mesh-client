import { describe, expect, it } from 'vitest';

import {
  BEACON_PRESETS,
  COLORADO_BEACON_URL,
  CORESCOPE_PRESETS,
  findBeaconPreset,
  findRegionalFeedPreset,
  getRegionalFeedPresets,
} from './beaconPresets';

describe('Beacon service presets', () => {
  it('keeps every preset on a unique public HTTPS origin', () => {
    const presets = [...BEACON_PRESETS, ...CORESCOPE_PRESETS];
    expect(new Set(presets.map((preset) => `${preset.provider}:${preset.id}`)).size).toBe(
      presets.length,
    );
    expect(new Set(presets.map((preset) => preset.baseUrl)).size).toBe(presets.length);
    for (const preset of presets) {
      const url = new URL(preset.baseUrl);
      expect(url.protocol).toBe('https:');
      expect(preset.baseUrl).toBe(url.origin);
      expect(url.username).toBe('');
      expect(url.password).toBe('');
    }
  });

  it('keeps community Beacon and CoreScope deployments in their own provider catalogs', () => {
    expect(getRegionalFeedPresets('beacon')).toBe(BEACON_PRESETS);
    expect(getRegionalFeedPresets('corescope')).toBe(CORESCOPE_PRESETS);
    for (const preset of [...BEACON_PRESETS, ...CORESCOPE_PRESETS]) {
      expect(findRegionalFeedPreset(preset.baseUrl, preset.provider)).toBe(preset);
      expect(
        findRegionalFeedPreset(
          preset.baseUrl,
          preset.provider === 'beacon' ? 'corescope' : 'beacon',
        ),
      ).toBeUndefined();
    }
    expect(findRegionalFeedPreset('https://meshcore.meshat.se/', 'corescope')?.id).toBe(
      'meshat-sweden',
    );
    expect(findBeaconPreset('https://beacon.meshat.se/')?.id).toBe('meshat-sweden');
  });

  it('recognizes a saved service URL with normalized hostname and trailing slash', () => {
    expect(findBeaconPreset(` ${COLORADO_BEACON_URL.toUpperCase()}/ `)?.id).toBe('colorado');
    expect(findBeaconPreset('https://beacon.meshat.se/')?.id).toBe('meshat-sweden');
  });

  it.each([
    `${COLORADO_BEACON_URL}/admin`,
    `${COLORADO_BEACON_URL}?key=secret`,
    `${COLORADO_BEACON_URL}#token`,
    'https://user:secret@map.meshcore.coloradomesh.org',
    'https://my-community.example.org',
    'unfinished input',
  ])('keeps custom or invalid origins editable: %s', (url) => {
    expect(findBeaconPreset(url)).toBeUndefined();
  });
});
