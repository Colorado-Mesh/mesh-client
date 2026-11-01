export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'uk', label: 'Українська' },
  { code: 'de', label: 'Deutsch' },
  { code: 'zh', label: '中文' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'pl', label: 'Polski' },
  { code: 'cs', label: 'Čeština' },
  { code: 'ja', label: '日本語' },
  { code: 'ru', label: 'Русский' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'ko', label: '한국어' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'id', label: 'Bahasa Indonesia' },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LANGUAGES)[number]['code'];

/**
 * Language bases that use right-to-left script. Kept as plain tags (not
 * SupportedLocale) so RTL document plumbing works before ar/he ship as
 * selectable languages with translated bundles.
 */
export const RTL_LANGUAGE_BASES = ['ar', 'he'] as const;

export type TextDirection = 'ltr' | 'rtl';

/** Base language subtag of a BCP-47 tag (`ar-EG` → `ar`). */
function baseLanguage(code: string): string {
  return code.split(/[-_]/)[0]?.toLowerCase() ?? '';
}

export function getTextDirection(code: string | null | undefined): TextDirection {
  if (!code) return 'ltr';
  const base = baseLanguage(code);
  return (RTL_LANGUAGE_BASES as readonly string[]).includes(base) ? 'rtl' : 'ltr';
}
