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
/**
 * Vendored MECP packs (CC BY 4.0, https://github.com/xiang-dev-1/MECP `languages/`).
 * Upstream JSON includes a website `ui` block and other unread metadata; this app
 * strips those keys. A resync must strip them again and keep `codes` / `categories`.
 * English stays on the main chunk; other packs load on demand.
 */
import enLanguage from './languages/en.json';

/** Meta.ai / plan wire check: MECP/<0-3>/… */
export const MECP_REGEX = /^MECP\/[0-3]\//;

export type MecpParsed = ParsedMessage;

export type { CategoryLetter, EncodeResult, LanguageFile, Severity };
export { CATEGORIES, encode, getByteLength, isMECP, MAX_MESSAGE_BYTES, MECP_PREFIX };

const FALLBACK_LANGUAGE: LanguageFile = enLanguage;

const LANGUAGE_MODULES: Partial<Record<string, LanguageFile>> = {
  en: FALLBACK_LANGUAGE,
};

/**
 * Lazy-load non-English packs so the default path stays light.
 * Keys must stay inside the range of `mecpLanguageForAppLocale` (fa/no/sk/sr/sv
 * are omitted: that function never returns them). `zh-tw` stays: the mapper
 * returns it for `zh-tw`, `zh-hant`, and `zh-tw*`.
 */
const LANGUAGE_LOADERS: Partial<Record<string, () => Promise<{ default: LanguageFile }>>> = {
  cs: () => import('./languages/cs.json'),
  de: () => import('./languages/de.json'),
  es: () => import('./languages/es.json'),
  fr: () => import('./languages/fr.json'),
  it: () => import('./languages/it.json'),
  ja: () => import('./languages/ja.json'),
  nl: () => import('./languages/nl.json'),
  pl: () => import('./languages/pl.json'),
  pt: () => import('./languages/pt.json'),
  ru: () => import('./languages/ru.json'),
  tr: () => import('./languages/tr.json'),
  uk: () => import('./languages/uk.json'),
  'zh-cn': () => import('./languages/zh-cn.json'),
  'zh-tw': () => import('./languages/zh-tw.json'),
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

/** Same shape as the decoder GPS pattern, plus the optional `#` tag prefix. */
const MECP_COORDS_REGEX = /#?(-?\d+\.\d+),\s*(-?\d+\.\d+)/g;

/** Parse `lat,lon` / `#lat,lon` from MECP freetext; null when absent or out of range. */
export function extractMecpCoords(freetext: string): { lat: number; lon: number } | null {
  if (typeof freetext !== 'string' || freetext.length === 0) return null;
  MECP_COORDS_REGEX.lastIndex = 0;
  const match = MECP_COORDS_REGEX.exec(freetext);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Remove GPS tokens so resent reports with updated coordinates still fingerprint-match. */
export function stripMecpCoordsFromFreetext(freetext: string): string {
  if (typeof freetext !== 'string' || freetext.length === 0) return '';
  MECP_COORDS_REGEX.lastIndex = 0;
  return freetext.replace(MECP_COORDS_REGEX, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeMecpFreetext(freetext: string): string {
  return freetext.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Normalized freetext with coordinates stripped (identity for incident merge / fingerprint). */
export function normalizeMecpFreetextForMatch(freetext: string): string {
  return normalizeMecpFreetext(stripMecpCoordsFromFreetext(freetext));
}

/** cyrb53: fast non-cryptographic 53-bit string hash (stable across sessions). */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Protocol-independent incident id so the same report heard over Meshtastic,
 * MeshCore, and Reticulum (e.g. via the RF rebroadcast bridge) merges into one row.
 * Coordinates are stripped so a GPS update from the same sender does not fork a new row.
 */
export function incidentFingerprint(parts: {
  severity: number;
  codes: string[];
  freetext: string;
  senderId: string;
}): string {
  const codes = [...new Set(parts.codes.map((c) => c.trim().toUpperCase()))].sort().join(',');
  const key = [
    String(parts.severity),
    codes,
    normalizeMecpFreetextForMatch(parts.freetext),
    parts.senderId.trim().toLowerCase(),
  ].join('|');
  return `mecp-${cyrb53(key)}`;
}

/** Payload identity without sender — used to merge bridged copies from a relay node id. */
export function incidentPayloadMatchKey(parts: {
  severity: number;
  codes: string[];
  freetext: string;
}): string {
  const codes = [...new Set(parts.codes.map((c) => c.trim().toUpperCase()))].sort().join(',');
  return [String(parts.severity), codes, normalizeMecpFreetextForMatch(parts.freetext)].join('|');
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
