/** Offline availability is checked against the pinned Mozilla manifest, not the app locale. */
export const TRANSLATION_LANGUAGES = [
  'en',
  'cs',
  'de',
  'es',
  'fr',
  'id',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'tr',
  'uk',
  'zh',
] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

export function normalizeTranslationLanguage(value: string): string {
  return value.toLowerCase().split(/[-_]/)[0] ?? '';
}

export function isTranslationLanguage(value: unknown): value is TranslationLanguage {
  return typeof value === 'string' && TRANSLATION_LANGUAGES.some((language) => language === value);
}

export function translationPath(source: string, target: string): string[] {
  if (source === target) return [];
  return source === 'en' || target === 'en'
    ? [`${source}-${target}`]
    : [`${source}-en`, `en-${target}`];
}
