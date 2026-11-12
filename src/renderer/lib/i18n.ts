import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en/translation.json';
import { resolveAppLocale } from '../locales/languages';
import { getAppSettingsRaw } from './appSettingsStorage';
import { applyDocumentDirection } from './documentDirection';
import { parseStoredJson } from './parseStoredJson';

const storedLocale = parseStoredJson<{ locale?: unknown }>(
  getAppSettingsRaw(),
  'i18n init',
)?.locale;
const lng = resolveAppLocale(storedLocale);

void i18next.use(initReactI18next).init({
  lng,
  fallbackLng: 'en',
  partialBundledLanguages: true,
  resources: {
    en: { translation: en },
  },
  interpolation: { escapeValue: false },
});

console.debug('[i18n] locale resolved', lng, storedLocale === undefined ? '(default)' : '(stored)');

// Keep <html dir/lang> in sync with the active language (RTL bases: ar, he).
applyDocumentDirection(lng);
i18next.on('languageChanged', applyDocumentDirection);

export default i18next;
