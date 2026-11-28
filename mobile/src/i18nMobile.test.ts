import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import { installMobileI18n, MOBILE_DESKTOP_OVERRIDES, MOBILE_LOCALES } from './i18nMobile';

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

const DESKTOP_BUNDLES = import.meta.glob<Record<string, unknown>>(
  '../../src/renderer/locales/*/translation.json',
  { eager: true, import: 'default' },
);

function desktopBundle(lng: string): Record<string, unknown> {
  const entry = Object.entries(DESKTOP_BUNDLES).find(([file]) =>
    file.endsWith(`/locales/${lng}/translation.json`),
  );
  if (!entry) throw new Error(`no desktop bundle for ${lng}`);
  return entry[1];
}

function valueAt(obj: unknown, keyPath: string): unknown {
  return keyPath
    .split('.')
    .reduce<unknown>(
      (o, part) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[part] : undefined),
      obj,
    );
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();
}

const DASH_GLYPHS = [String.fromCodePoint(0x2013), String.fromCodePoint(0x2014)];
const OVERRIDE_KEYS = keyPaths(MOBILE_DESKTOP_OVERRIDES.en).sort();

describe('desktop strings the mobile apps word for a phone', () => {
  it('covers the same keys in all 16 app languages', () => {
    expect(Object.keys(MOBILE_DESKTOP_OVERRIDES).sort()).toEqual([...LOCALES].sort());
    expect(OVERRIDE_KEYS.length).toBeGreaterThan(0);
    for (const lng of LOCALES) {
      expect(keyPaths(MOBILE_DESKTOP_OVERRIDES[lng]).sort(), lng).toEqual(OVERRIDE_KEYS);
    }
  });

  it('only replaces desktop sentences that name the computer, keeping their placeholders', () => {
    const desktopEnglish = desktopBundle('en');
    for (const key of OVERRIDE_KEYS) expect(valueAt(desktopEnglish, key), key).toMatch(/computer/i);
    for (const lng of LOCALES) {
      const desktop = desktopBundle(lng);
      for (const key of OVERRIDE_KEYS) {
        const mobile = valueAt(MOBILE_DESKTOP_OVERRIDES[lng], key);
        const desktopValue = valueAt(desktop, key);
        expect(typeof mobile, `${lng} ${key}`).toBe('string');
        expect(typeof desktopValue, `${lng} ${key} in the desktop bundle`).toBe('string');
        expect(placeholders(mobile as string), `${lng} ${key}`).toEqual(
          placeholders(desktopValue as string),
        );
        for (const dash of DASH_GLYPHS) expect((mobile as string).includes(dash)).toBe(false);
      }
    }
  });

  it('writes over a desktop bundle that is already loaded', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'en',
      resources: {
        en: {
          translation: {
            locationPrompt: {
              fixedLabel: "This computer doesn't move (don't ask each launch)",
              titleUnknown: 'Set your location',
            },
          },
        },
      },
    });
    installMobileI18n(i18n);
    expect(i18n.t('locationPrompt.fixedLabel')).toBe(
      "This phone doesn't move (don't ask each launch)",
    );
    // Keys outside the reviewed list keep the desktop wording.
    expect(i18n.t('locationPrompt.titleUnknown')).toBe('Set your location');
  });

  it('still wins when the desktop adds a language later with overwrite on', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } });
    installMobileI18n(i18n);
    // localeResources.ts loads a language like this, after the mobile strings are installed.
    i18n.addResourceBundle(
      'de',
      'translation',
      { locationPrompt: { fixedLabel: valueAt(desktopBundle('de'), 'locationPrompt.fixedLabel') } },
      true,
      true,
    );
    await i18n.changeLanguage('de');
    expect(i18n.t('locationPrompt.fixedLabel')).toBe(
      valueAt(MOBILE_DESKTOP_OVERRIDES.de, 'locationPrompt.fixedLabel'),
    );
    expect(i18n.t('locationPrompt.fixedLabel')).toMatch(/Telefon/);
  });
});
