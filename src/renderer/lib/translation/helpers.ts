import { TRANSLATION_MIN_LETTERS } from '@/shared/translation-types';
import {
  normalizeTranslationLanguage,
  TRANSLATION_LANGUAGES,
  translationPath,
} from '@/shared/translationLanguages';

export function readsTranslationLanguage(
  language: string,
  readLanguages: readonly string[],
): boolean {
  return readLanguages.some(
    (read) => normalizeTranslationLanguage(read) === normalizeTranslationLanguage(language),
  );
}

/** Packs that automatic translation needs to bring every unread language into `target`. */
export function neededTranslationPacks(target: string, readLanguages: readonly string[]): string[] {
  const needed = new Set<string>();
  for (const source of TRANSLATION_LANGUAGES) {
    if (source === target || readsTranslationLanguage(source, readLanguages)) continue;
    for (const id of translationPath(source, target)) needed.add(id);
  }
  return [...needed];
}

/** Mesh control/data payloads stay intact; translating them produces misleading prose. */
export function skipMessageTranslation(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.match(/\p{L}/gu)?.length ?? 0) < TRANSLATION_MIN_LETTERS ||
    trimmed.split(/\s+/).every((word) => /^https?:\/\/\S+$/i.test(word)) ||
    /^(?:MECP|mecp:|geo:|\[voice:|\[file:|\[location:|r:[a-f0-9]+:|g:|\{"|\[\{)/i.test(trimmed) ||
    /(?:\bforecast\b|\d\s*°\s*[FC]\b|\bHi\s*-?\d+\s*\/\s*Lo\s*-?\d+)/i.test(trimmed) ||
    /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/.test(trimmed)
  );
}

export async function translationCacheKey(
  text: string,
  target: string,
  provider: string,
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `${provider}:${target}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function translationMessageKey(message: string, text: string, target: string): string {
  return JSON.stringify([message, target, text]);
}
