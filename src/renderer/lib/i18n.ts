import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en/translation.json';
import { getAppSettingsRaw } from './appSettingsStorage';
import { DEFAULT_APP_SETTINGS_SHARED } from './defaultAppSettings';
import { applyDocumentDirection } from './documentDirection';
import { parseStoredJson } from './parseStoredJson';

const stored = parseStoredJson<{ locale?: string }>(getAppSettingsRaw(), 'i18n init');
const lng = stored?.locale ?? DEFAULT_APP_SETTINGS_SHARED.locale;

void i18next.use(initReactI18next).init({
  lng,
  fallbackLng: 'en',
  partialBundledLanguages: true,
  resources: {
    en: { translation: en },
  },
  interpolation: { escapeValue: false },
});

// Keep <html dir/lang> in sync with the active language (RTL bases: ar, he).
applyDocumentDirection(lng);
i18next.on('languageChanged', applyDocumentDirection);

export default i18next;
