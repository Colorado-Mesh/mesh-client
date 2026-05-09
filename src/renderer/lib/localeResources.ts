import type { i18n as I18nInstance } from 'i18next';

import type { SupportedLocale } from '../locales/languages';
import { SUPPORTED_LANGUAGES } from '../locales/languages';

const loadedLocales = new Set<string>(['en']);

const localeBundles: Record<
  Exclude<SupportedLocale, 'en'>,
  () => Promise<{ default: Record<string, unknown> }>
> = {
  cs: () => import('../locales/cs/translation.json'),
  de: () => import('../locales/de/translation.json'),
  es: () => import('../locales/es/translation.json'),
  fr: () => import('../locales/fr/translation.json'),
  id: () => import('../locales/id/translation.json'),
  it: () => import('../locales/it/translation.json'),
  ja: () => import('../locales/ja/translation.json'),
  ko: () => import('../locales/ko/translation.json'),
  nl: () => import('../locales/nl/translation.json'),
  pl: () => import('../locales/pl/translation.json'),
  'pt-BR': () => import('../locales/pt-BR/translation.json'),
  ru: () => import('../locales/ru/translation.json'),
  tr: () => import('../locales/tr/translation.json'),
  uk: () => import('../locales/uk/translation.json'),
  zh: () => import('../locales/zh/translation.json'),
};

export function isSupportedLocale(code: string): code is SupportedLocale {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

/**
 * Loads locale JSON into i18next (code-split). English is bundled in i18n init.
 * Failure point: dynamic import or invalid JSON — fallback: log, switch to `en`, return false.
 * @returns false only when a supported non-English bundle failed to load
 */
export async function ensureLocaleLoaded(i18n: I18nInstance, code: string): Promise<boolean> {
  if (code === 'en' || loadedLocales.has(code)) return true;
  if (!isSupportedLocale(code)) return true;

  try {
    const load = localeBundles[code as Exclude<SupportedLocale, 'en'>];
    const mod = await load();
    i18n.addResourceBundle(code, 'translation', mod.default, true, true);
    loadedLocales.add(code);
    return true;
  } catch (err) {
    console.error('ensureLocaleLoaded: failed to load locale', code, err);
    await i18n.changeLanguage('en');
    return false;
  }
}
