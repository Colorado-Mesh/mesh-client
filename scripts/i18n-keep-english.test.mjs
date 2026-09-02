/**
 * Keep-English contract: protobuf-derived codes and brand names must never be handed
 * to a translation engine. "ANZ" comes back as prose and "TAK" as the Turkish word
 * for "yes", both of which the locale quality checker rejects.
 */
import { describe, expect, it } from 'vitest';

import { filterMissingKeysToTranslate, isKeepEnglishKey } from './i18n-auto-translate-lib.mjs';

describe('isKeepEnglishKey', () => {
  const protectedKeys = [
    'radioPanel.regions.EU_868.label',
    'radioPanel.modemPresets.SHORT_FAST.label',
    'radioPanel.oledTypes.OLED_SH1106.label',
    'radioPanel.displayUnits.METRIC.label',
    'radioPanel.deviceRoles.ROUTER.label',
    'radioPanel.deviceRoles.TAK.description',
    'radioPanel.deviceRoles.TAK_TRACKER.description',
  ];

  it.each(protectedKeys)('protects %s', (key) => {
    expect(isKeepEnglishKey(key)).toBe(true);
  });

  const translatableKeys = [
    'radioPanel.deviceRoles.ROUTER.description',
    'radioPanel.deviceRoles.CLIENT.description',
    'radioPanel.lockdown.provision',
    'chatPanel.sendFailed',
    'radioPanel.enumDeprecatedSuffix',
  ];

  it.each(translatableKeys)('leaves %s translatable', (key) => {
    expect(isKeepEnglishKey(key)).toBe(false);
  });
});

describe('filterMissingKeysToTranslate keep-English handling', () => {
  const enFlat = {
    'radioPanel.regions.EU_868.label': 'EU 868',
    'radioPanel.lockdown.provision': 'Provision lockdown',
  };
  const opts = { translateAllGaps: true, hasGitBaseline: false, enFlat };

  it('queues a protected key only when the locale is missing it', () => {
    const missing = filterMissingKeysToTranslate(Object.keys(enFlat), {}, null, opts);

    expect(missing).toContain('radioPanel.regions.EU_868.label');
  });

  it('never re-queues a protected key the locale already has', () => {
    const existing = { 'radioPanel.regions.EU_868.label': 'EU 868' };
    const missing = filterMissingKeysToTranslate(Object.keys(enFlat), existing, null, opts);

    expect(missing).not.toContain('radioPanel.regions.EU_868.label');
    expect(missing).toContain('radioPanel.lockdown.provision');
  });

  it('does not audit-retranslate a protected key that matches English', () => {
    const existing = {
      'radioPanel.regions.EU_868.label': 'EU 868',
      'radioPanel.lockdown.provision': 'Provision lockdown',
    };
    const missing = filterMissingKeysToTranslate(Object.keys(enFlat), existing, null, {
      ...opts,
      translateAllGaps: false,
      auditIdentical: true,
    });

    expect(missing).not.toContain('radioPanel.regions.EU_868.label');
  });
});
