/**
 * App-facing MECP helpers wrapping the vendored engine
 * (https://github.com/xiang-dev-1/MECP, GPLv3).
 */

import type { CategoryLetter, EncodeResult, LanguageFile, ParsedMessage, Severity } from './engine';
import {
  CATEGORIES,
  decode,
  encode,
  getByteLength,
  isMECP,
  MAX_MESSAGE_BYTES,
  MECP_PREFIX,
} from './engine';
import enLanguage from './languages/en.json';

/** Meta.ai / plan wire check: MECP/<0-3>/… */
export const MECP_REGEX = /^MECP\/[0-3]\//;

export type MecpParsed = ParsedMessage;

export type { CategoryLetter, EncodeResult, LanguageFile, Severity };
export { CATEGORIES, encode, getByteLength, isMECP, MAX_MESSAGE_BYTES, MECP_PREFIX };

const FALLBACK_LANGUAGE: LanguageFile = enLanguage as LanguageFile;

const LANGUAGE_MODULES: Partial<Record<string, LanguageFile>> = {
  en: FALLBACK_LANGUAGE,
};

/** Lazy-load non-English packs so the default path stays light. */
const LANGUAGE_LOADERS: Partial<Record<string, () => Promise<{ default: LanguageFile }>>> = {
  cs: () => import('./languages/cs.json').then((m) => ({ default: m.default as LanguageFile })),
  de: () => import('./languages/de.json').then((m) => ({ default: m.default as LanguageFile })),
  es: () => import('./languages/es.json').then((m) => ({ default: m.default as LanguageFile })),
  fa: () => import('./languages/fa.json').then((m) => ({ default: m.default as LanguageFile })),
  fr: () => import('./languages/fr.json').then((m) => ({ default: m.default as LanguageFile })),
  it: () => import('./languages/it.json').then((m) => ({ default: m.default as LanguageFile })),
  ja: () => import('./languages/ja.json').then((m) => ({ default: m.default as LanguageFile })),
  nl: () => import('./languages/nl.json').then((m) => ({ default: m.default as LanguageFile })),
  no: () => import('./languages/no.json').then((m) => ({ default: m.default as LanguageFile })),
  pl: () => import('./languages/pl.json').then((m) => ({ default: m.default as LanguageFile })),
  pt: () => import('./languages/pt.json').then((m) => ({ default: m.default as LanguageFile })),
  ru: () => import('./languages/ru.json').then((m) => ({ default: m.default as LanguageFile })),
  sk: () => import('./languages/sk.json').then((m) => ({ default: m.default as LanguageFile })),
  sr: () => import('./languages/sr.json').then((m) => ({ default: m.default as LanguageFile })),
  sv: () => import('./languages/sv.json').then((m) => ({ default: m.default as LanguageFile })),
  tr: () => import('./languages/tr.json').then((m) => ({ default: m.default as LanguageFile })),
  uk: () => import('./languages/uk.json').then((m) => ({ default: m.default as LanguageFile })),
  'zh-cn': () =>
    import('./languages/zh-cn.json').then((m) => ({ default: m.default as LanguageFile })),
  'zh-tw': () =>
    import('./languages/zh-tw.json').then((m) => ({ default: m.default as LanguageFile })),
};

export function mecpLanguageForAppLocale(appLocale: string): string {
  const base = appLocale.toLowerCase().split('-')[0] ?? 'en';
  const full = appLocale.toLowerCase();
  if (full === 'zh-cn' || full === 'zh-hans' || full.startsWith('zh-cn')) return 'zh-cn';
  if (full === 'zh-tw' || full === 'zh-hant' || full.startsWith('zh-tw')) return 'zh-tw';
  if (full.startsWith('pt')) return 'pt';
  const mapped: Record<string, string> = {
    en: 'en',
    cs: 'cs',
    de: 'de',
    es: 'es',
    fr: 'fr',
    it: 'it',
    ja: 'ja',
    nl: 'nl',
    pl: 'pl',
    ru: 'ru',
    tr: 'tr',
    uk: 'uk',
    zh: 'zh-cn',
  };
  return mapped[base] ?? 'en';
}

export function getCachedMecpLanguage(lang: string): LanguageFile {
  return LANGUAGE_MODULES[lang] ?? FALLBACK_LANGUAGE;
}

export async function loadMecpLanguage(lang: string): Promise<LanguageFile> {
  const cached = LANGUAGE_MODULES[lang];
  if (cached) return cached;
  const loader = LANGUAGE_LOADERS[lang];
  if (!loader) return FALLBACK_LANGUAGE;
  try {
    const mod = await loader();
    LANGUAGE_MODULES[lang] = mod.default;
    return mod.default;
  } catch (e) {
    console.warn('[mecp] failed to load language', lang, e);
    return FALLBACK_LANGUAGE;
  }
}

/**
 * Strict parse: prefix + successful decode + severity 0–3.
 * Returns null when the text is not a valid MECP report.
 */
export function tryParseMecp(text: string): MecpParsed | null {
  if (typeof text !== 'string' || !MECP_REGEX.test(text)) return null;
  const parsed = decode(text);
  if (!parsed.valid || parsed.severity === null) return null;
  return parsed;
}

export function isMecpMessage(text: string): boolean {
  return tryParseMecp(text) !== null;
}

export function isMecpDrill(parsed: MecpParsed): boolean {
  return parsed.isDrill;
}

export function severityLabelKey(severity: Severity): string {
  switch (severity) {
    case 0:
      return 'mecp.severity.mayday';
    case 1:
      return 'mecp.severity.urgent';
    case 2:
      return 'mecp.severity.safety';
    case 3:
      return 'mecp.severity.routine';
  }
}

export function localizeMecpCodes(parsed: MecpParsed, lang: LanguageFile): string {
  const parts: string[] = [];
  for (const code of parsed.codes) {
    const local = lang.codes[code];
    parts.push(local ? `${code} ${local}` : code);
  }
  if (parsed.extracted.count != null) {
    parts.push(`${parsed.extracted.count}pax`);
  }
  if (parsed.extracted.gps) {
    parts.push(`${parsed.extracted.gps.lat},${parsed.extracted.gps.lon}`);
  }
  return parts.join(' · ');
}
