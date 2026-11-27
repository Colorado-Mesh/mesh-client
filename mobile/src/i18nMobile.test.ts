import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import { installMobileI18n, MOBILE_LOCALES } from './i18nMobile';

const LOCALES = [
  'cs',
  'de',
  'en',
  'es',
  'fr',
  'id',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt-BR',
  'ru',
  'tr',
  'uk',
  'zh',
];

function keyPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('mobile i18n bundles', () => {
  it('ships every mobile key in all 16 app languages', () => {
    expect(Object.keys(MOBILE_LOCALES).sort()).toEqual([...LOCALES].sort());
    const english = keyPaths(MOBILE_LOCALES.en).sort();
    for (const lng of LOCALES) expect(keyPaths(MOBILE_LOCALES[lng]).sort(), lng).toEqual(english);
  });

  it('merges into the translation namespace without overwriting desktop strings', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'en',
      resources: { en: { translation: { locationPrompt: { titleUnknown: 'Set your location' } } } },
    });
    installMobileI18n(i18n);
    expect(i18n.t('locationPrompt.titleUnknown')).toBe('Set your location');
    expect(i18n.t('locationPrompt.usePhoneLocation')).toBe("Use this phone's location");
  });

  it('adds the mobile strings to a language bundle loaded later', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } });
    installMobileI18n(i18n);
    i18n.addResourceBundle('de', 'translation', { app: { name: 'Mesh Client' } });
    await i18n.changeLanguage('de');
    expect(i18n.t('mobile.tryAgain')).toBe(
      MOBILE_LOCALES.de.mobile && (MOBILE_LOCALES.de.mobile as Record<string, string>).tryAgain,
    );
    expect(i18n.t('app.name')).toBe('Mesh Client');
  });
});
